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
		}
	};
	
	// Internal class properties
	var _map = null;
	var _urlParameters = {};
	var _itineraryId = null;
	var _markers = [];
	var _routeGeojson = false;
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
		geocoder: function (addTo, callbackFunction)
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
						callbackFunction (ui.item);
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
				if (_routeGeojson) {
					if (!confirm ('Clear existing route?')) {
						return;
					}
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
			}
		},
		
		
		// Function to add route loading
		loadRouteId: function ()
		{
			$('#loadrouteid').click (function (e) {
				
				// If a route is already loaded, prompt to remove it
				if (_routeGeojson) {
					if (!confirm ('Clear existing route?')) {
						return;
					}
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
			var html = '<h2>Route planning</h2>';
			$('#routeplanning').append (html);
			
			// Add input widgets
			var totalWaypoints = 2;
			var waypointName;
			var nextWaypointName;
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
				var input = '<p><input name="' + waypointName + '" type="search" placeholder="' + label + '" /></p>';
				$('#routeplanning').append (input);
				routing.geocoder ('#routeplanning input[name="' + waypointName + '"]', function (item) {
					
					// Fire a click on the map
					// #!# Note that use of map.fire is now deprecated: https://gis.stackexchange.com/a/210289/58752
					var point = _map.project ([item.lon, item.lat]);	// https://github.com/mapbox/mapbox-gl-js/issues/5060
					_map.fire ('click', { lngLat: {lng: item.lon, lat: item.lat} }, point);
				});
			}
			
			
		},
		
		
		// Function to add routing
		routing: function ()
		{
			// Load routing when style ready
			_map.on ('style.load', function () {
				
				// If the route is already loaded, show it
				if (_routeGeojson) {
					routing.showRoute (_routeGeojson);
					return;
				}
				
				// Get map locations
				// https://www.mapbox.com/mapbox-gl-js/example/mouse-position/
				var waypoints = [];
				var totalWaypoints = 0;
				_map.on ('click', function (e) {
					
					// Take no action on the click handler if a route is loaded
					if (_routeGeojson) {return;}
					
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
			
			// Assemble the API URL
			var url = _settings.cyclestreetsApiBaseUrl + '/v2/journey.plan?waypoints=' + waypointStrings.join ('|') + '&plans=balanced&archive=full&key=' + _settings.cyclestreetsApiKey;
			
			// Load the route
			routing.loadRoute (url, false);
		},
		
		
		// Function to load a route from a specified itinerary ID
		loadRouteFromId: function (itineraryId)
		{
			// For now, obtain a fixed GeoJSON string
			var url = _settings.cyclestreetsApiBaseUrl + '/v2/journey.retrieve?itinerary=' + itineraryId + '&plans=balanced&key=' + _settings.cyclestreetsApiKey;
			
			// Load the route
			routing.loadRoute (url, true);
		},
		
		
		// Function to load a route over AJAX
		loadRoute: function (url, fitBounds)
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
					
					// Register the GeoJSON to enable the state to persist between map layer changes and to set that the route is loaded
					_routeGeojson = result;
					
					// Show the route
					routing.showRoute (_routeGeojson);
					
					// Set the itinerary number permalink in the URL
					var itineraryId = _routeGeojson.properties.id;
					routing.updateUrl (itineraryId);
					
					// Fit bounds if required
					if (fitBounds) {
						routing.fitBoundsGeojson (_routeGeojson, 'balanced');
					}
					
					// Show clear route link
					$('#clearroute').show ();
				},
				error: function (jqXHR, textStatus, errorThrown) {
					alert ('Sorry, the route could not be loaded.');
					console.log (errorThrown);
				}
			});
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
		showRoute: function (geojson)
		{
			// https://www.mapbox.com/mapbox-gl-js/example/geojson-line/
			var layer = {
				"id": "route",
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
					"line-color": "purple",
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
			geojson.features.forEach (function (marker) {
				if (marker.properties.hasOwnProperty('waypoint')) {
					totalWaypoints++;
				}
			});
			
			// Add markers; see: https://www.mapbox.com/help/custom-markers-gl-js/
			// Unfortunately Mapbox GL makes this much more difficult than Leaflet.js and has to be done at DOM level; see: https://github.com/mapbox/mapbox-gl-js/issues/656
			geojson.features.forEach (function (marker) {
				if (marker.geometry.type == 'Point') {	// Apply only to points
					var text;
					switch (marker.properties.waypoint) {
						case 1: text = geojson.properties.start; break;
						case totalWaypoints: text = geojson.properties.finish; break;
						default: text = false; break;
					}
					routing.addWaypointMarker (marker.geometry.coordinates, marker.properties.waypoint, text, totalWaypoints);
				}
			});
			
			// For each marker, if moved, replan the route
			// https://www.mapbox.com/mapbox-gl-js/example/drag-a-marker/
			if (_routeGeojson) {
				$.each (_markers, function (index, marker) {
					_markers[index].on ('dragend', function (e) {
						
						// Construct the waypoints lng,lon list
						var waypoints = [];
						$.each (_markers, function (index, marker) {
							waypoints.push (marker._lngLat);
						});
						
						// Remove the existing route
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
			// Remove the layer
			_map.removeLayer ("route");
			_map.removeSource ("route");
			
			// Unset the route data
			_routeGeojson = false;

			// Clear any existing markers
			$.each (_markers, function (index, marker) {
				marker.remove();
			});
			_markers = [];
			
			// Remove the itinerary ID
			_itineraryId = false;
			
			// Reparse the URL
			routing.parseUrl ();
			
			// Update the URL
			routing.updateUrl (_itineraryId);
		},
		
		
		// Function to add a waypoint marker
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
		},
		
		
		// Function to make data entity-safe
		htmlspecialchars: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
	};
	
} (jQuery));

