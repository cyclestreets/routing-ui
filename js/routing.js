// Route planning / satnav user interface

/*jslint browser: true, white: true, single: true, for: true */
/*global $, alert, console, window, mapboxgl */

var routing = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	var _settings = {
		
		// CycleStreets API
		cyclestreetsApiBaseUrl: 'https://api.cyclestreets.net',
		cyclestreetsApiKey: 'YOUR_CYCLESTREETS_API_KEY',
		
		// Max zoom
		maxZoom: 20,
		
		// Geocoder API URL; re-use of settings values represented as placeholders {%cyclestreetsApiBaseUrl}, {%cyclestreetsApiKey}, {%autocompleteBbox}, are supported
		geocoderApiUrl: '{%cyclestreetsApiBaseUrl}/v2/geocoder?key={%cyclestreetsApiKey}&bounded=1&bbox={%autocompleteBbox}',
		
		// BBOX for autocomplete results biasing
		autocompleteBbox: '-6.6577,49.9370,1.7797,57.6924',
		
		// Images; size set in CSS with .itinerarymarker
		images: {
			start: '/images/itinerarymarkers/start.png',
			waypoint: '/images/itinerarymarkers/waypoint.png',
			finish: '/images/itinerarymarkers/finish.png'
		},
		
		// Routing strategies, in order of appearance in the UI, and the default
		defaultStrategy: 'balanced',
		strategies: [
			{
				id: 'fastest',
				label: 'Fastest route',
				parameters: {plans: 'fastest'},
				lineColour: '#cc0000',
				format: 'cyclestreets'
			},
			{
				id: 'balanced',
				label: 'Balanced route',
				parameters: {plans: 'balanced'},
				lineColour: '#ffc200',
				format: 'cyclestreets'
			},
			{
				id: 'quietest',
				label: 'Quietest route',
				parameters: {plans: 'quietest'},
				lineColour: '#00cc00',
				format: 'cyclestreets'
			}
			/* OSRM example:
			,
			{
				id: 'routing',
				label: 'routing',
				baseUrl: 'https://www.example.com/routing/',
				parameters: {},
				lineColour: '#336699',
				format: 'osrm'
			}
			*/
		]
	};
	
	// Internal class properties
	var _map = null;
	var _urlParameters = {};
	var _itineraryId = null;
	var _markers = [];
	var _routeGeojson = {};
	var _panningEnabled = false;
	
	
	return {
		
		// Main entry point
		initialise: function (config, map, panningEnabled)
		{
			// Merge the configuration into the settings
			$.each (_settings, function (setting, value) {
				if (config.hasOwnProperty(setting)) {
					_settings[setting] = config[setting];
				}
			});
			
			// Create handles
			_map = map;
			_panningEnabled = panningEnabled;
			
			// Parse the URL
			routing.parseUrl ();
			
			// Add toolbox (pending implementation of overall UI)
			routing.toolbox ();
			
			// Add panning control
			routing.controlPanning ();
			
			// Add route clearing
			routing.routeClearing ();
			
			// Load route from URL if present
			routing.loadRouteInitialUrl ();
			
			// Add load route ID functionality
			routing.loadRouteId ();
			
			// Add route planning UI
			routing.routePlanning ();
			
			// Add routing
			routing.routing ();
		},
		
		
		// Function to create a control in a corner
		// See: https://www.mapbox.com/mapbox-gl-js/api/#icontrol
		createControl: function (id, position)
		{
			function HelloWorldControl() { }
			
			HelloWorldControl.prototype.onAdd = function(_map) {
				this._map = map;
				this._container = document.createElement('div');
				this._container.setAttribute ('id', id);
				this._container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl local';
				return this._container;
			};
			
			HelloWorldControl.prototype.onRemove = function () {
				this._container.parentNode.removeChild(this._container);
				this._map = undefined;
			};
			
			// #!# Need to add icon and hover; partial example at: https://github.com/schulzsebastian/mapboxgl-legend/blob/master/index.js
			
			// Instiantiate and add the control
			_map.addControl (new HelloWorldControl (), position);
		},
		
		
		// Function to add a geocoder control
		geocoder: function (addTo, callbackFunction, callbackData)
		{
			// Geocoder URL; re-use of settings values is supported, represented as placeholders {%cyclestreetsApiBaseUrl}, {%cyclestreetsApiKey}, {%autocompleteBbox}
			var geocoderApiUrl = routing.settingsPlaceholderSubstitution (_settings.geocoderApiUrl, ['cyclestreetsApiBaseUrl', 'cyclestreetsApiKey', 'autocompleteBbox']);
			
			// Attach the autocomplete library behaviour to the location control
			autocomplete.addTo (addTo, {
				sourceUrl: geocoderApiUrl,
				select: function (event, ui) {
					var bbox = ui.item.feature.properties.bbox.split(',');
					_map.setMaxZoom (18);	// Prevent excessive zoom to give context
					_map.fitBounds([ [bbox[0], bbox[1]], [bbox[2], bbox[3]] ]);	// Note that Mapbox GL JS uses sw,ne rather than ws,en as in Leaflet.js
					_map.setMaxZoom (_settings.maxZoom);	// Reset
					if (callbackFunction) {
						callbackFunction (ui.item, callbackData);
					}
					event.preventDefault();
				}
			});
		},
		
		
		// Helper function to implement settings placeholder substitution in a string
		settingsPlaceholderSubstitution: function (string, supportedPlaceholders)
		{
			// Substitute each placeholder
			var placeholder;
			$.each(supportedPlaceholders, function (index, field) {
				placeholder = '{%' + field + '}';
				string = string.replace(placeholder, _settings[field]);
			});
			
			// Return the modified string
			return string;
		},
		
		
		// Function to parse the URL
		parseUrl: function ()
		{
			// Start a list of parameters
			var urlParameters = {};
			
			// Extract journey URL
			urlParameters.itineraryId = false;
			var matches = window.location.pathname.match (/^\/journey\/([0-9]+)\/$/);
			if (matches) {
				urlParameters.itineraryId = matches[1];
			}
			
			// Set the parameters
			_urlParameters = urlParameters;
		},
		
		
		// Function to add a toolbox
		toolbox: function ()
		{
			// Add layer switcher UI
			var control = this.createControl ('toolbox', 'bottom-left');

			// Construct HTML for layer switcher
			var html = '<ul id="toolbox">';
			html += '<li><a id="clearroute" href="#" class="hidden">Clear route &hellip;</a></li>';
			html += '<li><a id="loadrouteid" href="#">Load route ID &hellip;</a></li>';
			html += '<li><a id="panning" href="#" class="hidden">Panning: disabled</a></li>';
			html += '</ul>';
			$('#toolbox').append (html);
		},
		
		
		// Control panning
		// NB Two-finger gesture on mobile for pitch not yet supported: https://github.com/mapbox/mapbox-gl-js/issues/3405
		controlPanning: function ()
		{
/*
			// Enable pan on rotate
			// https://github.com/mapbox/mapbox-gl-js/issues/3357
			_map.on ('rotateend', function () {
				_panningEnabled = true;
				routing.setPanningIndicator ();
			});
*/
			
			// Toggle panning on/off, and update the control
			$('#panning').on ('click', function () {
				_panningEnabled = !_panningEnabled;
				routing.setPanningIndicator ();
				
				// Switch to top-down view when not enabled
				if (!_panningEnabled) {
					_map.setPitch (0);
				}
			});
		},
		
		
		// Set text for panning control
		setPanningIndicator: function ()
		{
			var text = (_panningEnabled ? 'Panning: enabled' : 'Panning: disabled');
			$('#panning').text (text);
		},
		
		
		// Add a clear route handler
		routeClearing: function ()
		{
			$('#clearroute').click (function (e) {
				
				// If a route is already loaded, prompt to remove it
				if (!$.isEmptyObject (_routeGeojson)) {
					if (!confirm ('Clear existing route?')) {
						return;
					}
					
					// Remove the route for each strategy
					routing.removeRoute ();
					
					// Hide clear route link
					$('#clearroute').hide ();
				}
			});
		},
		
		
		// Function to an initial route
		loadRouteInitialUrl: function ()
		{
			// Load the route if an itinerary ID is set
			if (_urlParameters.itineraryId) {
				_itineraryId = _urlParameters.itineraryId;
				routing.loadRouteFromId (_itineraryId);
				
				// Add results tabs
				routing.resultsTabs ();
			}
		},
		
		
		// Function to add route loading
		loadRouteId: function ()
		{
			// Run on clicking on UI link
			$('#loadrouteid').click (function (e) {
				
				// If a route is already loaded, prompt to remove it
				if (!$.isEmptyObject (_routeGeojson)) {
					if (!confirm ('Clear existing route?')) {
						return;
					}
					
					// Remove the route for each strategy
					routing.removeRoute ();
				}
				
				// For now, request an itinerary ID if not already entered, or end
				_itineraryId = prompt ('CycleStreets journey number?', '63248473');
				if (!_itineraryId) {return;}
				
				// Load the route
				routing.loadRouteFromId (_itineraryId);
				
				// Prevent link following
				e.preventDefault ();
			});
		},
		
		
		// Function to add a route planning UI
		routePlanning: function ()
		{
			// Add layer switcher UI
			var control = this.createControl ('routeplanning', 'bottom-right');
			
			// Add title
			var html = '<h2>Route planner</h2>';
			$('#routeplanning').append (html);
			
			// Add input widgets
			var totalWaypoints = 2;
			var waypointName;
			var label;
			for (var waypointNumber = 0; waypointNumber < totalWaypoints; waypointNumber++) {
				
				// Set the label
				switch (waypointNumber) {
					case 0: label = 'Start'; break;
					case (totalWaypoints - 1): label = 'Finish'; break;
					default: 'Waypoint';
				}
				
				// Create the input widget and attach a geocoder to it
				waypointName = 'waypoint' + waypointNumber;
				var input = '<p><input name="' + waypointName + '" type="search" placeholder="' + label + '" class="geocoder" /></p>';
				$('#routeplanning').append (input);
				routing.geocoder ('#routeplanning input[name="' + waypointName + '"]', function (item, callbackData) {
					
					// Fire a click on the map
					// #!# Note that use of map.fire is now deprecated: https://gis.stackexchange.com/a/210289/58752
					var point = _map.project ([item.lon, item.lat]);	// https://github.com/mapbox/mapbox-gl-js/issues/5060
					_map.fire ('click', { lngLat: {lng: item.lon, lat: item.lat} }, point);
					
					// Move focus to next geocoder input box if present
					routing.focusFirstAvailableGeocoder (totalWaypoints);
					
				}, {totalWaypoints: totalWaypoints});
			}
			
			// Put focus on the first available geocoder
			routing.focusFirstAvailableGeocoder (totalWaypoints);
		},
		
		
		// Helper function to put focus in the first available geocoder control
		focusFirstAvailableGeocoder: function (totalWaypoints)
		{
			// Loop through each available slot
			var waypointName;
			var element;
			for (var waypointNumber = 0; waypointNumber < totalWaypoints; waypointNumber++) {
				
				// Check if this geocoder input exists
				waypointName = 'waypoint' + waypointNumber;
				element = '#routeplanning input[name="' + waypointName + '"]';
				if ($(element).length) {
					
					// If empty, set its focus, and end
					if (!$(element).val ()) {
						$(element).focus ();
						return;
					}
				}
			}
		},
		
		
		// Function to set the geocoder location box value
		setGeocoderLocationName: function (name, waypointNumber)
		{
			// If no name, set to null value
			if (name === false) {
				name = '(Could not find location name)';
			}
			
			// Set the value if the input box is present
			var waypointName = 'waypoint' + (waypointNumber - 1);
			var element = '#routeplanning input[name="' + waypointName + '"]';
			if ($(element).length) {
				$(element).val (name);
			}
		},
		
		
		// Function to add routing
		routing: function ()
		{
			// Load routing when style ready or when style changed - the whole application logic is wrapped in this, as the entire state must be recreated if the style is changed
			// May need to consider use of: https://stackoverflow.com/questions/44394573/mapbox-gl-js-style-is-not-done-loading
			// #!# Does not fire when loading a raster after another raster: https://github.com/mapbox/mapbox-gl-js/issues/7579
			_map.on ('style.load', function () {
				
				// If the route is already loaded, show it
				if (!$.isEmptyObject (_routeGeojson)) {
					
					// Add the route for each strategy, and end
					$.each (_settings.strategies, function (index, strategy) {
						routing.showRoute (_routeGeojson[strategy.id], strategy.id, strategy.lineColour);
					});
					
					// Add results tabs
					routing.resultsTabs ();
					
					return;
				}
				
				// Get map locations
				// https://www.mapbox.com/mapbox-gl-js/example/mouse-position/
				var waypoints = [];
				var totalWaypoints = 0;
				_map.on ('click', function (e) {
					
					// Take no action on the click handler if a route is loaded
					if (!$.isEmptyObject (_routeGeojson)) {return;}
					
					// Register the waypoint
					waypoints.push (e.lngLat);
					totalWaypoints = waypoints.length;
					
					// Obtain the label
					// #!# Replace to using nearestpoint
					var label = (totalWaypoints == 1 ? 'Start' : 'Finish');
					
					// Add the waypoint marker
					routing.addWaypointMarker (e.lngLat, totalWaypoints, label, totalWaypoints);
					
					// Once there are two waypoints, load the route
					if (totalWaypoints == 2) {
						
						// Load the route
						routing.loadRouteFromWaypoints (waypoints);
						
						// Reset the waypoints count
						waypoints = [];
						totalWaypoints = 0;
					}
				});
			});
		},
		
		
		// Function to load a route from specified waypoints, each containing a lng,lat pair
		loadRouteFromWaypoints (waypoints)
		{
			// Convert waypoints to strings
			var waypointStrings = [];
			var waypointString;
			$.each (waypoints, function (index, waypoint) {
				waypointString = parseFloat(waypoint.lng).toFixed(6) + ',' + parseFloat(waypoint.lat).toFixed(6);
				waypointStrings.push (waypointString);
			});
			
			// Add results tabs
			routing.resultsTabs ();
			
			// Load the route for each strategy
			var parameters = {};
			var url;
			$.each (_settings.strategies, function (index, strategy) {
				
				// Construct the route request based on the format
				switch (strategy.format) {
					
					// CycleStreets API V2
					case 'cyclestreets':
						parameters = $.extend (true, {}, strategy.parameters);	// i.e. clone
						parameters.key = _settings.cyclestreetsApiKey;
						parameters.waypoints = waypointStrings.join ('|');
						parameters.archive = 'full';
						parameters.itineraryFields = 'id,start,finish,waypointCount';
						url = _settings.cyclestreetsApiBaseUrl + '/v2/journey.plan' + '?' + $.param (parameters, false);
						break;
						
					// OSRM (V5+)
					case 'osrm':
						parameters = $.extend (true, {}, strategy.parameters);	// i.e. clone
						parameters.alternatives = 'false';
						parameters.overview = 'full';
						parameters.steps = 'true';
						parameters.geometries = 'geojson';
						var waypoints = waypointStrings.join (';');
						url = strategy.baseUrl + '/route/v1/driving/' + waypoints + '?' + $.param (parameters, false);
						break;
				}
				
				// Load the route
				//console.log (url);
				routing.loadRoute (url, strategy.format, strategy.id, strategy.lineColour);
			});
		},
		
		
		// Function to create result tabs; see: https://jqueryui.com/tabs/
		resultsTabs: function ()
		{
			// Create tabs and content panes for each of the strategies
			var tabsHtml = '<ul id="strategies">';
			var contentPanesHtml = '<div id="itineraries">';
			var rgb;
			var selectedIndex = 0;
			$.each (_settings.strategies, function (index, strategy) {
				rgb = routing.hexToRgb (strategy.lineColour);
				tabsHtml += '<li><a href="#' + strategy.id + '" style="background-color: rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + '0.3' + ');">' + routing.htmlspecialchars (strategy.label) + '</a></li>';
				contentPanesHtml += '<div id="' + strategy.id + '">' + routing.htmlspecialchars (strategy.label) + ' details loading &hellip;</div>';
				if (strategy.id == _settings.defaultStrategy) {selectedIndex = index;}
			});
			tabsHtml += '</ul>';
			contentPanesHtml += '</div>';
			
			// Assemble the HTML
			var html = tabsHtml + contentPanesHtml;
			
			// Surround with a div for styling
			html = '<div id="results">' + html + '</div>';
			
			// Append the panel to the route planning UI
			$('#routeplanning').append (html);
			
			// Add jQuery UI tabs behaviour
			$('#results').tabs ();
			
			// Select the default tab
			$('#results').tabs ('option', 'active', selectedIndex);
		},
		
		
		// Function to convert colour codes in Hex to RGB
		hexToRgb: function (colour)
		{
			// If the colour is a name, convert to Hex
			var hex = routing.colourNameToHex (colour);
			
			// Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
			var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
			hex = hex.replace (shorthandRegex, function (m, r, g, b) {
				return r + r + g + g + b + b;
			});
			
			// Assemble the result
			var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
			return result ? {
				r: parseInt (result[1], 16),
				g: parseInt (result[2], 16),
				b: parseInt (result[3], 16)
			} : null;
		},
		
		
		// Function to convert HTML colour names to Hex; see: https://stackoverflow.com/a/1573141/180733
		colourNameToHex: function (colour)
		{
			var colours = {
				'aliceblue': '#f0f8ff',
				'antiquewhite': '#faebd7',
				'aqua': '#00ffff',
				'aquamarine': '#7fffd4',
				'azure': '#f0ffff',
				'beige': '#f5f5dc',
				'bisque': '#ffe4c4',
				'black': '#000000',
				'blanchedalmond': '#ffebcd',
				'blue': '#0000ff',
				'blueviolet': '#8a2be2',
				'brown': '#a52a2a',
				'burlywood': '#deb887',
				'cadetblue': '#5f9ea0',
				'chartreuse': '#7fff00',
				'chocolate': '#d2691e',
				'coral': '#ff7f50',
				'cornflowerblue': '#6495ed',
				'cornsilk': '#fff8dc',
				'crimson': '#dc143c',
				'cyan': '#00ffff',
				'darkblue': '#00008b',
				'darkcyan': '#008b8b',
				'darkgoldenrod': '#b8860b',
				'darkgray': '#a9a9a9',
				'darkgreen': '#006400',
				'darkkhaki': '#bdb76b',
				'darkmagenta': '#8b008b',
				'darkolivegreen': '#556b2f',
				'darkorange': '#ff8c00',
				'darkorchid': '#9932cc',
				'darkred': '#8b0000',
				'darksalmon': '#e9967a',
				'darkseagreen': '#8fbc8f',
				'darkslateblue': '#483d8b',
				'darkslategray': '#2f4f4f',
				'darkturquoise': '#00ced1',
				'darkviolet': '#9400d3',
				'deeppink': '#ff1493',
				'deepskyblue': '#00bfff',
				'dimgray': '#696969',
				'dodgerblue': '#1e90ff',
				'firebrick': '#b22222',
				'floralwhite': '#fffaf0',
				'forestgreen': '#228b22',
				'fuchsia': '#ff00ff',
				'gainsboro': '#dcdcdc',
				'ghostwhite': '#f8f8ff',
				'gold': '#ffd700',
				'goldenrod': '#daa520',
				'gray': '#808080',
				'green': '#008000',
				'greenyellow': '#adff2f',
				'honeydew': '#f0fff0',
				'hotpink': '#ff69b4',
				'indianred ': '#cd5c5c',
				'indigo': '#4b0082',
				'ivory': '#fffff0',
				'khaki': '#f0e68c',
				'lavender': '#e6e6fa',
				'lavenderblush': '#fff0f5',
				'lawngreen': '#7cfc00',
				'lemonchiffon': '#fffacd',
				'lightblue': '#add8e6',
				'lightcoral': '#f08080',
				'lightcyan': '#e0ffff',
				'lightgoldenrodyellow': '#fafad2',
				'lightgrey': '#d3d3d3',
				'lightgreen': '#90ee90',
				'lightpink': '#ffb6c1',
				'lightsalmon': '#ffa07a',
				'lightseagreen': '#20b2aa',
				'lightskyblue': '#87cefa',
				'lightslategray': '#778899',
				'lightsteelblue': '#b0c4de',
				'lightyellow': '#ffffe0',
				'lime': '#00ff00',
				'limegreen': '#32cd32',
				'linen': '#faf0e6',
				'magenta': '#ff00ff',
				'maroon': '#800000',
				'mediumaquamarine': '#66cdaa',
				'mediumblue': '#0000cd',
				'mediumorchid': '#ba55d3',
				'mediumpurple': '#9370d8',
				'mediumseagreen': '#3cb371',
				'mediumslateblue': '#7b68ee',
				'mediumspringgreen': '#00fa9a',
				'mediumturquoise': '#48d1cc',
				'mediumvioletred': '#c71585',
				'midnightblue': '#191970',
				'mintcream': '#f5fffa',
				'mistyrose': '#ffe4e1',
				'moccasin': '#ffe4b5',
				'navajowhite': '#ffdead',
				'navy': '#000080',
				'oldlace': '#fdf5e6',
				'olive': '#808000',
				'olivedrab': '#6b8e23',
				'orange': '#ffa500',
				'orangered': '#ff4500',
				'orchid': '#da70d6',
				'palegoldenrod': '#eee8aa',
				'palegreen': '#98fb98',
				'paleturquoise': '#afeeee',
				'palevioletred': '#d87093',
				'papayawhip': '#ffefd5',
				'peachpuff': '#ffdab9',
				'peru': '#cd853f',
				'pink': '#ffc0cb',
				'plum': '#dda0dd',
				'powderblue': '#b0e0e6',
				'purple': '#800080',
				'rebeccapurple': '#663399',
				'red': '#ff0000',
				'rosybrown': '#bc8f8f',
				'royalblue': '#4169e1',
				'saddlebrown': '#8b4513',
				'salmon': '#fa8072',
				'sandybrown': '#f4a460',
				'seagreen': '#2e8b57',
				'seashell': '#fff5ee',
				'sienna': '#a0522d',
				'silver': '#c0c0c0',
				'skyblue': '#87ceeb',
				'slateblue': '#6a5acd',
				'slategray': '#708090',
				'snow': '#fffafa',
				'springgreen': '#00ff7f',
				'steelblue': '#4682b4',
				'tan': '#d2b48c',
				'teal': '#008080',
				'thistle': '#d8bfd8',
				'tomato': '#ff6347',
				'turquoise': '#40e0d0',
				'violet': '#ee82ee',
				'wheat': '#f5deb3',
				'white': '#ffffff',
				'whitesmoke': '#f5f5f5',
				'yellow': '#ffff00',
				'yellowgreen': '#9acd32'
			};
			
			// Return the substituted colour
			if (typeof colours[colour.toLowerCase()] != 'undefined')
				return colours[colour.toLowerCase()];
			
			// Else pass through as-is
			return colour;
		},
		
		
		// Function to create an itinerary listing from the loaded route data
		itineraryListing: function (id, features)
		{
			// Loop through each feature
			var html = '<table class="itinerary lines">';
			$.each (features, function (index, feature) {
				
				// Skip non-streets
				if (!feature.properties.path.match (/street/)) {return 'continue';}
				
				// Add this row
				html += '<tr>';
				html += '<td>' + feature.properties.startBearing + '</td>';
				html += '<td><strong>' + routing.htmlspecialchars (feature.properties.name) + '</strong></td>';
				html += '<td>' + feature.properties.ridingSurface + '</td>';
				html += '<td>' + feature.properties.distanceMetres + 'm</td>';
				html += '<td>' + feature.properties.durationSeconds + 's</td>';
				html += '</tr>';
			});
			html += '</table>';
			
			// Set the content in the tab pane
			$('#itineraries #' + id).html (html);
		},
		
		
		// Function to load a route from a specified itinerary ID
		loadRouteFromId: function (itineraryId)
		{
			// Load the route for each strategy
			var parameters = {};
			var url;
			$.each (_settings.strategies, function (index, strategy) {
				
				// Construct the route request
				parameters = $.extend (true, {}, strategy.parameters);	// i.e. clone
				parameters.key = _settings.cyclestreetsApiKey;
				parameters.id = itineraryId;
				parameters.itineraryFields = 'id,start,finish,waypointCount';
				url = _settings.cyclestreetsApiBaseUrl + '/v2/journey.retrieve' + '?' + $.param (parameters, false);
				
				// Load the route
				routing.loadRoute (url, 'cyclestreets', strategy.id, strategy.lineColour);
			});
			
			// Add results tabs
			routing.resultsTabs ();
		},
		
		
		// Function to load a route over AJAX
		loadRoute: function (url, format, strategy, lineColour)
		{
			// Load over AJAX; see: https://stackoverflow.com/a/48655332/180733
			$.ajax({
				dataType: 'json',
				url: url,
				success: function (result) {
					
					// Detect error in result
					if (result.error) {
						alert ('Sorry, the route could not be loaded: ' + result.error);
						return;
					}
					
					// For OSRM format, convert to (emulate) the CycleStreets GeoJSON format
					if (format == 'osrm') {
						result = routing.osrmToGeojson (result, strategy);
					}
					
					// Register the GeoJSON to enable the state to persist between map layer changes and to set that the route is loaded
					_routeGeojson[strategy] = result;
					
					// Show the route
					routing.showRoute (_routeGeojson[strategy], strategy, lineColour);
					
					// Set the itinerary number permalink in the URL
					var itineraryId = _routeGeojson[strategy].properties.id;
					routing.updateUrl (itineraryId);
					
					// Fit bounds
					routing.fitBoundsGeojson (_routeGeojson[strategy], strategy);
					
					// Show clear route link
					$('#clearroute').show ();
				},
				error: function (jqXHR, textStatus, errorThrown) {
					alert ('Sorry, the route could not be loaded.');
					console.log (errorThrown);
				}
			});
		},
		
		
		// Function to convert an OSRM route result to the CycleStreets GeoJSON format
		// OSRM format: https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md
		// CycleStreets format: https://www.cyclestreets.net/api/v2/journey.plan/
		osrmToGeojson: function (osrm, strategy)
		{
			// Determine the number of waypoints
			var totalWaypoints = osrm.waypoints.length;
			var lastWaypoint = totalWaypoints - 1;
			
			// Start the features list
			var features = [];
			
			// First, add each waypoint as a feature
			var waypointNumber;
			$.each (osrm.waypoints, function (index, waypoint) {
				waypointNumber = index + 1;
				features.push ({
					type: 'Feature',
					properties: {
						path: 'waypoint/' + waypointNumber,
						number: waypointNumber,
						markerTag: (waypointNumber == 1 ? 'start' : (waypointNumber == totalWaypoints ? 'finish' : 'intermediate'))
					},
					geometry: {
						type: 'Point',
						coordinates: waypoint.location	// Already present as [lon, lat]
					}
				});
			});
			
			// Next, add the full route, facilitated using overview=full
			features.push ({
				type: 'Feature',
				properties: {
					path: 'plan/' + strategy,
					plan: strategy,
					elevationsMetresCsv: null,
					distancesMetresCsv: null,
					lengthMetres: osrm.routes[0].distance,
					timeSeconds: osrm.routes[0].duration
				},
				geometry: osrm.routes[0].geometry	// Already in GeoJSON coordinates format
			});
			
			// Next, add each step
			$.each (osrm.routes[0].legs[0].steps, function (index, step) {
				
				// Skip final arrival node
				if (step.maneuver.type == 'arrive') {return 'continue;'}
				
				// Add the feature
				features.push ({
					type: 'Feature',
					properties: {
						path: 'plan/' + strategy + '/street/' + (index + 1),
						number: (index + 1),
						legNumber: (index + 1),
						name: step.name,
						distanceMetres: step.distance,
						durationSeconds: step.duration,
						busynanceMetres: -1,			// Not available in OSRM
						balancederMetres: -1,			// Not available in OSRM
						ridingSurface: '',				// Not available in OSRM
						color: '',						// Not available in OSRM
						travelMode: step.mode,
						elevationsMetresCsv: '',		// Not available in OSRM
						distancesMetresCsv: '',			// Not available in OSRM
						signalledJunctions: step.intersections.length,
						signalledCrossings: -1,			// Not available in OSRM
						hurdleTypeCsv: '',				// Not available in OSRM
						hurdleTypeIdCsv: '',			// Not available in OSRM
						startBearing: step.maneuver.bearing_before,
						finishBearing: step.maneuver.bearing_after,
						turnPrevAngle: -1,				// Not available in OSRM
						turnPrevText: '',				// Not available in OSRM
						photosEnRouteCsv: ''			// Not available in OSRM
					},
					geometry: step.geometry	// Already in GeoJSON coordinates format
				});
			});
			
			// Assemble the GeoJSON structure
			var geojson = {
				type: 'FeatureCollection',
				properties: {
					id: null,							// Not available in OSRM
					start: osrm.waypoints[0].name,
					finish: osrm.waypoints[lastWaypoint].name,
					waypointCount: totalWaypoints
				},
				features: features
			};
			
			//console.log (JSON.stringify (geojson));
			
			// Return the result
			return geojson;
		},
		
		
		// Function to fit bounds for a GeoJSON result
		// https://www.mapbox.com/mapbox-gl-js/example/zoomto-linestring/
		fitBoundsGeojson: function (geojson, plan)
		{
			// Find the coordinates in the result
			var coordinates;
			$.each (geojson.features, function (index, feature) {
				if (feature.properties.plan == plan && feature.geometry.type == 'LineString') {
					coordinates = feature.geometry.coordinates;
					return;		// I.e. break, as now found
				}
			});
			
			// Obtain the bounds
			var bounds = coordinates.reduce (function (bounds, coord) {
				return bounds.extend (coord);
			}, new mapboxgl.LngLatBounds (coordinates[0], coordinates[0]));
			
			// Fit bounds
			_map.setMaxZoom (17);	// Prevent excessive zoom to give context
			_map.fitBounds (bounds, {padding: 60});
			_map.setMaxZoom (_settings.maxZoom);	// Reset
		},
		
		
		// Function to render a route onto the map
		showRoute: function (geojson, id, lineColour)
		{
			// https://www.mapbox.com/mapbox-gl-js/example/geojson-line/
			var layer = {
				"id": id,
				"type": "line",
				"source": {
					"type": "geojson",
					"data": geojson,
					"attribution": 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
				},
				"layout": {
					"line-join": "round",
					"line-cap": "round"
				},
				"paint": {
					"line-color": lineColour,
					"line-width": 8
				}
			};
			_map.addLayer (layer);
			
			// Clear any existing markers
			$.each (_markers, function (index, marker) {
				marker.remove();
			});
			_markers = [];
			
			// Determine the number of waypoints
			var totalWaypoints = 0;
			$.each (geojson.features, function (index, feature) {
				if (feature.properties.hasOwnProperty ('markerTag')) {
					totalWaypoints++;
				}
			});
			
			// Add markers; see: https://www.mapbox.com/help/custom-markers-gl-js/
			$.each (geojson.features, function (index, feature) {
				if (feature.geometry.type == 'Point') {	// Apply only to points
					var text;
					var waypointNumber = parseInt (feature.properties.path.replace ('waypoint/', ''));	// E.g.'waypoint/1' becomes 1
					switch (waypointNumber) {
						case 1: text = geojson.properties.start; break;
						case totalWaypoints: text = geojson.properties.finish; break;
						default: text = false; break;
					}
					var coordinates = {lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1]};
					routing.addWaypointMarker (coordinates, waypointNumber, text, totalWaypoints);
				}
			});
			
			// Add the itinerary listing
			routing.itineraryListing (id, geojson.features);
			
			// For each marker, if moved, replan the route
			// https://www.mapbox.com/mapbox-gl-js/example/drag-a-marker/
			if (!$.isEmptyObject (_routeGeojson)) {
				$.each (_markers, function (index, marker) {
					_markers[index].on ('dragend', function (e) {
						
						// Construct the waypoints lng,lon list
						var waypoints = [];
						$.each (_markers, function (index, marker) {
							waypoints.push (marker._lngLat);
						});
						
						// Remove the route for each strategy
						routing.removeRoute ();
						
						// Load the route from the waypoints
						routing.loadRouteFromWaypoints (waypoints);
						
						// Remove the current handler and the other handlers for the other markers
						// See: https://stackoverflow.com/questions/21415897/removing-a-jquery-event-handler-while-inside-the-event-handler
						$(this).off ('dragend');
					});
				});
			}
		},
		
		
		// Function to update the URL, to provide persistency when a route is present
		updateUrl: function (itineraryId)
		{
			// End if not supported, e.g. IE9
			if (!history.pushState) {return;}
			
			// Construct the URL slug
			var urlSlug = '/';
			if (itineraryId) {
				urlSlug = '/journey/' + itineraryId + '/';
			}
			
			// Construct the URL
			var url = '';
			url += urlSlug;
			url += window.location.hash;
			
			// Construct the page title, based on the enabled layers
			var title = 'CycleStreets';
			if (itineraryId) {
				title += ': journey #' + itineraryId;
			}
			
			// Push the URL state
			history.pushState (urlSlug, title, url);
			document.title = title;		// Workaround for poor browser support; see: https://stackoverflow.com/questions/13955520/
		},
		
		
		// Function to remove a drawn route currently present
		removeRoute: function ()
		{
			// Remove the layer for each strategy
			$.each (_routeGeojson, function (id, routeGeojson) {
				_map.removeLayer (id);
				_map.removeSource (id);
			});
			
			// Unset the route data
			_routeGeojson = {};

			// Clear any existing markers
			$.each (_markers, function (index, marker) {
				marker.remove();
			});
			_markers = [];
			
			// Remove the itinerary ID
			_itineraryId = false;
			
			// Remove the result tabs if present
			$('#routeplanning #results').tabs ('destroy');	// http://api.jqueryui.com/tabs/
			$('#routeplanning #results').remove ();
			
			// Reparse the URL
			routing.parseUrl ();
			
			// Update the URL
			routing.updateUrl (_itineraryId);
		},
		
		
		// Function to add a waypoint marker
		// Unfortunately Mapbox GL makes this much more difficult than Leaflet.js and has to be done at DOM level; see: https://github.com/mapbox/mapbox-gl-js/issues/656
		addWaypointMarker: function (coordinates, waypointNumber, label, totalWaypoints)
		{
			// Determine the image and text to use
			var image;
			var text;
			switch (waypointNumber) {
				case 1:
					image = _settings.images.start;
					text = 'Start at: <strong>' + routing.htmlspecialchars (label) + '</strong>';
					break;
				case totalWaypoints:
					image = _settings.images.finish;
					text = 'Finish at: <strong>' + routing.htmlspecialchars (label) + '</strong>';
					break;
				default:
					image = _settings.images.waypoint;
					text = 'Via: Waypoint #' + (waypointNumber - 1);	// #!# API needs to provide street location name
					break;
			}
			
			// Assemble the image as a DOM element
			var itinerarymarker = document.createElement('div');
			itinerarymarker.className = 'itinerarymarker';
			itinerarymarker.style.backgroundImage = "url('" + image + "')";
			
			// Add the marker
			var marker = new mapboxgl.Marker({element: itinerarymarker, offset: [0, -22], draggable: true})	// See: https://www.mapbox.com/mapbox-gl-js/api/#marker
				.setLngLat(coordinates)
				.setPopup( new mapboxgl.Popup({ offset: 25 }).setHTML(text) )
				.addTo(_map);
			
			// Register the marker
			_markers.push (marker);
			
			// Perform a reverse geocoding of the location
			routing.reverseGeocode (coordinates, waypointNumber);
		},
		
		
		// Function to reverse geocode a location
		reverseGeocode: function (coordinates, waypointNumber)
		{
			// Assemble API URL; see: https://www.cyclestreets.net/api/v2/nearestpoint/
			var parameters = {
				key: _settings.cyclestreetsApiKey,
				lonlat: coordinates.lng + ',' + coordinates.lat
			}
			var url = _settings.cyclestreetsApiBaseUrl + '/v2/nearestpoint' + '?' + $.param (parameters, false);
			
			// Fetch the result
			$.ajax ({
				dataType: 'json',
				url: url,
				success: function (result) {
					
					// Detect error in result
					if (result.error) {
						routing.setGeocoderLocationName (false, waypointNumber);
						return;
					}
					
					// Set the location name
					routing.setGeocoderLocationName (result.features[0].properties.name, waypointNumber);
				},
				error: function (jqXHR, textStatus, errorThrown) {
					routing.setGeocoderLocationName (false, waypointNumber);
					console.log (errorThrown);
				}
			});
		},
		
		
		// Function to make data entity-safe
		htmlspecialchars: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
	};
	
} (jQuery));

