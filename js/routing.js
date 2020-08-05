// Route planning / satnav user interface

/*jslint browser: true, white: true, single: true, for: true */
/*global $, jQuery, alert, console, window, confirm, prompt, mapboxgl, autocomplete, satnav */


/*
	Route planning UI specification:
	
	- The journey planner operates on the basis of a stack of points, e.g. start,intermediate,finish
	- The stack is indexed from 0 internally
	- Each marker has an associated geocoder (also expressable in reverse - each geocoder affects a marker).
	- Marker/geocoder pairs operate in sync - setting/moving/updating one affects its pair with the same geographical result.
	- A marker/geocoder pair is referred to as a 'waypoint'.
	- There can be as many waypoints as the user wants.
	- Whenever two or more waypoints are set, a route should be displayed.
	- Whenever no or one waypoint is set, no route should be displayed.
	- When the map is clicked on to set a marker, the marker is shown as gray until the geocoder provides a resolved actual location.
	- A route request is triggered whenever any change to any waypoint is made, with the result being added or replacing any existing result.
	- The marker for each waypoint has a popup which gives the resolved name matching the geocoder.
	- The marker's popup and the associated geocoder each have an 'X' button to delete that waypoint.
	- When a route is present, the only map-based way to add another waypoint is to drag part of the existing line to pull out (create) a new intermediate waypoint.
	- The geocoder list contains a + button between each to create a new empty geocoder.
	- Empty geocoders are not treated as part of the stack counted.
	- When a route is present, adding a successful geocoder result inserts this into the stack in the order shown.
	- The geocoders, whether empty or complete, can be reordered without restriction, using drag-and-drop.
	- When markers are present, the start waypoint shall be green, the finish waypoint red, and intermediate waypoints yellow, labelled as "Via #1", "Via #2", etc.
	- When a previously-planned route number is loaded, this effectively pre-loads the stack, and the rest of the logic then works as normal.
	- When a route is present, the associated itinerary set is shown in a set of tabs.
	- When a itinerary street is hovered on, the associated part of the line is highlighted.
	- Conversely, when a part of the line is hovered on, the associated itinerary street is highlighted.
	- The rendering of each part of the route line relates to the riding surface.
	- All strategies for a route are shown at once.
	- On clicking on a strategy, it is brought into focus, and a cookie setting stores this last-clicked strategy.
	- On showing a route, the last-clicked strategy is shown, or if the cookie is not set, the default strategy defined in the settings is shown.
	- The strategy in focus is coloured, and the other strategies are grayed out.
	- A tooltip shows the summary for each strategy at all times.
	- Clicking on a route strategy on the map selects its associated tab in the itinerary panel.
	- Conversely, selecting a tab in the itinerary panel selects its associated route strategy on the map.
	- When a journey is planned, the URL is updated to include the lat,lon pairs
	- If a URL is present with lat,lon pairs, this is loaded as the intial route
	
*/


var routing = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	var _settings = {
		
		// Title
		title: 'CycleStreets',
		
		// CycleStreets API
		apiBaseUrl: 'https://api.cyclestreets.net',
		apiKey: 'YOUR_CYCLESTREETS_API_KEY',
		
		// Max zoom
		maxZoom: 20,
		maxZoomToSegment: 17,
		
		// Geocoder API URL; re-use of settings values represented as placeholders {%apiBaseUrl}, {%apiKey}, {%autocompleteBbox}, are supported
		geocoderApiUrl:        '{%apiBaseUrl}/v2/geocoder?key={%apiKey}&bounded=1&bbox={%autocompleteBbox}',
		reverseGeocoderApiUrl: '{%apiBaseUrl}/v2/nearestpoint?key={%apiKey}',
		
		// BBOX for autocomplete results biasing
		autocompleteBbox: '-6.6577,49.9370,1.7797,57.6924',
		
		// Images; size set in CSS with .itinerarymarker
		images: {
			start: '/images/itinerarymarkers/start.png',
			waypoint: '/images/itinerarymarkers/waypoint.png',
			finish: '/images/itinerarymarkers/finish.png'
		},
		
		// Initial route
		initialRoute: false,	// E.g. [[0.123902, 52.202968], [-0.127669, 51.507318]], as array of lon,lat pairs, or false to disable
		
		// Routing strategies, in order of appearance in the UI, and the default
		defaultStrategy: 'balanced',
		strategies: [
			{
				id: 'fastest',
				label: 'Fastest route',
				parameters: {plans: 'fastest'},
				lineColour: '#cc0000',
				lineColourOutline: 'red',
				attribution: 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
			},
			{
				id: 'balanced',
				label: 'Balanced route',
				parameters: {plans: 'balanced'},
				lineColour: '#ffc200',
				lineColourOutline: 'orange',
				attribution: 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
			},
			{
				id: 'quietest',
				label: 'Quietest route',
				parameters: {plans: 'quietest'},
				lineColour: '#00cc00',
				lineColourOutline: 'green',
				attribution: 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
			}
			/* Other routing engine example:
			,
			{
				id: 'routing',
				label: 'routing',
				baseUrl: 'https://www.example.com/routing/',
				parameters: {},
				lineColour: '#336699',
				routeRequest: routeRequest,			// Name of callback function to be defined in calling code, to assemble the routing request URL, as "function routeRequest (waypointStrings, strategyBaseUrl, strategyParameters) {...; return url}"
				geojsonConversion: outputToGeojson	// Name of callback function to be defined in calling code, to convert that engine's output to the CycleStreets GeoJSON format, as "function outputToGeojson (result, strategy) {...; return geojson}"
			}
			*/
		],
		
		// Line thickness
		lineThickness: {
			selected: 8,
			unselected: 3
		},
		lineOutlines: true,
		
		// Define the supported travel mode colours
		travelModeColours: {
			'dismounted': 'gray'
		},
		
		// Whether to show all route line results or just the currently-selected
		showAllRoutes: true,

		// Whether to plan routes the moment the map is clicked rather than wait until a routing button is pressed
		planRoutingOnMapClick: true,

		// Whether to show the basic Mapbox toolbox
		showToolBox: true,

		// Whether to prompt before clearing route
		promptBeforeClearingRoute: true
	};
	
	// Internal class properties
	var _map = null;
	var _isMobileDevice = false;
	var _urlParameters = {};
	var _itineraryId = null;
	var _waypoints = [];	// Ordered stack of waypoints, each with lng/lat/label
	var _markers = [];
	var _routeGeojson = {};
	var _panningEnabled = false;
	var _routeIndexes = {};
	var _popups = {};
	var _selectedStrategy = false;
	var _keyboardFeaturePosition = {};
	var _currentWaypointIndex = 0; // We start with no waypoints in our index
	var _elevationCharts = {}; // Store the elevation charts as global, so we can access them through the scrubber
	var _singleMarkerMode = false; // Set when only one waypoint should be clickable on the map, i.e., when setting home/work location
	var _singleMarkerLocation = []; // Store the coordinates of a single waypoint, when setting work/home location
	var _recentJourneys = []; // Store the latest planned routes
	var _recentSearches = []; // Store recent searches, used to populate the JP card

	return {
		
		// Main entry point
		initialise: function (config, map, isMobileDevice, panningEnabled)
		{
			// Merge the configuration into the settings
			$.each (_settings, function (setting, value) {
				if (config.hasOwnProperty(setting)) {
					_settings[setting] = config[setting];
				}
			});
			
			// Prevent viewport zooming, which is problematic for iOS Safari; see: https://stackoverflow.com/questions/37808180/
			document.addEventListener ('touchmove', function (event) {
				if (event.scale !== 1) {
					event.preventDefault ();
				}
			}, {passive: false});
			
			// Create handles
			_map = map;
			_isMobileDevice = isMobileDevice;
			_panningEnabled = panningEnabled;
			
			// Parse the URL
			routing.parseUrl ();
			
			// Set the initial default strategy, checking for a cookie from a previous page load
			var strategyCookie = routing.getCookie ('selectedstrategy');
			_selectedStrategy = strategyCookie || _settings.defaultStrategy;
			
			// Add toolbox (pending implementation of overall UI)
			routing.toolbox ();
			
			// Add panning control
			routing.controlPanning ();
			
			// Add route clearing
			routing.routeClearing ();
			
			// Create an index of strategies to tab index
			routing.loadRouteIndexes ();
			
			// If not showing all routes, set the line thickness to zero, so that it is does not display, but leave all other interaction in place
			if (!_settings.showAllRoutes) {
				_settings.lineThickness.unselected = 0;
			}
			
			// If line outlines are enabled, add the width
			if (_settings.lineOutlines) {
				_settings.lineThickness.selectedOutline = (_settings.lineThickness.selected + 4);
			}
			
			// Add route planning UI
			//routing.routePlanning ();
			// Connect existing inputs to goecoder autocomplete
			routing.routePlanningAlt ();

			// Add waypoint handlers
			routing.registerWaypointHandlers ();
			
			// Load route from URL (itinerary/waypoints) if present
			routing.loadRouteInitialUrl ();
			
			// Load route from settings if present (if URL not loaded)
			routing.loadRouteFromSettings ();
			
			// Add load route ID functionality
			routing.loadRouteId ();
			
			// Add routing
			routing.routingInit ();
		},
		
		
		// Getter
		getSelectedStrategy: function ()
		{
			return _selectedStrategy;
		},
		
		
		// Function to create a control in a corner
		// See: https://www.mapbox.com/mapbox-gl-js/api/#icontrol
		createControl: function (id, position)
		{
			var myControl = function () {};
			
			myControl.prototype.onAdd = function () {
				this.container = document.createElement('div');
				this.container.setAttribute ('id', id);
				this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl local';
				return this.container;
			};
			
			myControl.prototype.onRemove = function () {
				this.container.parentNode.removeChild (this.container);
				delete this.map;
			};
			
			// #!# Need to add icon and hover; partial example at: https://github.com/schulzsebastian/mapboxgl-legend/blob/master/index.js
			
			// Instiantiate and add the control
			_map.addControl (new myControl (), position);
		},
		
		
		// Function to add a geocoder control
		geocoder: function (addTo, callbackFunction, callbackData)
		{
			// Geocoder URL; re-use of settings values is supported, represented as placeholders {%apiBaseUrl}, {%apiKey}, {%autocompleteBbox}
			var geocoderApiUrl = routing.settingsPlaceholderSubstitution (_settings.geocoderApiUrl, ['apiBaseUrl', 'apiKey', 'autocompleteBbox']);
			
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
			$.each (supportedPlaceholders, function (index, field) {
				placeholder = '{%' + field + '}';
				string = string.replace (placeholder, _settings[field]);
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
			var matchesItinerary = window.location.pathname.match (/^\/journey\/([0-9]+)\/$/);
			if (matchesItinerary) {
				urlParameters.itineraryId = matchesItinerary[1];
			}
			
			// Extract journey URL
			urlParameters.waypoints = [];
			var matchesWaypoints = window.location.pathname.match (/^\/journey\/([-.0-9]+,[-.,\/0-9]+)\/$/);
			if (matchesWaypoints) {
				var waypointPairs = matchesWaypoints[1].split ('/');
				var waypoints = [];
				var waypointLatLon;
				$.each (waypointPairs, function (index, waypointPair) {
					var matches = waypointPair.match (/^([-.0-9]+),([-.0-9]+)$/);
					if (matches) {
						waypointLatLon = waypointPair.split (',');
						waypoints.push ({lng: waypointLatLon[1], lat: waypointLatLon[0], label: null});
					}
				});
				if (waypoints.length >=2) {
					urlParameters.waypoints = waypoints;
				}
			}
			
			// Set the parameters
			_urlParameters = urlParameters;
		},
		
		
		// Function to add a toolbox
		toolbox: function ()
		{
			if (_settings.showToolBox) {
				// Add layer switcher UI
				var control = routing.createControl ('toolbox', 'bottom-left');
							
				// Determine whether route loading from ID is supported; for this, all engines need to be native CycleStreets type
				var routeLoadingSupported = true;
				$.each (_settings.strategies, function (index, strategy) {
					if (strategy.routeRequest) {
						routeLoadingSupported = false;
					}
				});

				// Construct HTML for layer switcher
				var html = '<ul id="toolbox">';
				if (routeLoadingSupported) {
					html += '<li><a id="loadrouteid" href="#">Load route ID &hellip;</a></li>';
				}
				html += '<li><a id="panning" href="#" class="hidden">Panning: disabled</a></li>';
				html += '</ul>';
				$('#toolbox').append (html);
			}
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
				satnav.setPanningEnabled (_panningEnabled);
				
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
			// Create a delegated click function to clear the route
			$('body').on('click', '#clearroute', function (e) {
				
				// If a route is already loaded, prompt to remove it
				if (!$.isEmptyObject (_routeGeojson)) {
					if (_settings.promptBeforeClearingRoute) {
						if (!confirm ('Clear existing route?')) {
							return;
						}
					}

					// Remove the route for each strategy
					var retainWaypoints = true;
					var keepMarkers = true;
					routing.removeRoute (retainWaypoints, keepMarkers);
				}
			});
		},
		
		
		// Function to create an index of routes, e.g. for tab selection
		loadRouteIndexes: function ()
		{
			// Map from strategyId => index
			$.each (_settings.strategies, function (index, strategy) {
				_routeIndexes[strategy.id] = index;
			});
		},
		
		
		// Function to load an initial route from URL (itinerary/waypoints) if present
		loadRouteInitialUrl: function ()
		{
			// Load the route from an itinerary ID if set
			if (_urlParameters.itineraryId) {
				_itineraryId = _urlParameters.itineraryId;
				routing.loadRouteFromId (_itineraryId);
				
				// Add results tabs
				routing.resultsTabs ();
				
				// End, i.e. take precedence over waypoints
				return;
			}
			
			// Load the route from waypoints if set
			if (_urlParameters.waypoints) {
				_waypoints = _urlParameters.waypoints;
				routing.plannable ();
			}
		},
		
		
		// Function to load a route from settings
		loadRouteFromSettings: function ()
		{
			// End if not enabled in settings
			if (!_settings.initialRoute) {return;}
			
			// Take no action if waypoints already set
			if (_waypoints.length > 0) {return;}
			
			// Load the route from waypoints if set
			if (_settings.initialRoute) {
				$.each (_settings.initialRoute, function (index, waypoint) {
					_waypoints.push ({lng: waypoint[0], lat: waypoint[1], label: null});
				});
				routing.plannable ();
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


		// Function to check whether or not the route planning button should display as enabled
		enableOrDisableRoutePlanningButton: function ()
		{
			// If we have fewer than 2 waypoints, grey out the routing button
			if (_waypoints.length < 2) {
				$('.panel.journeyplanner.search #getRoutes').css('opacity',0.3);
			} else {
				$('.panel.journeyplanner.search #getRoutes').css('opacity',1);
			}
		},
		
		
		// Function run at launch to hook inputs up to geocoder
		routePlanningAlt: function ()
		{

			var journeyplannerInputs = $('.panel.journeyplanner input');
			var totalWaypoints = 2; // Default amount of waypoints, i.e. (0) Start and (1) Finish

			$.each(journeyplannerInputs, function(index, input) {
				// Register a handler for geocoding, attachable to any input
				routing.geocoder ('.panel.journeyplanner.search input[name="' + input.name + '"]', function (item, callbackData) {
				
					// Add the waypoint marker
					var waypoint = {lng: item.lon, lat: item.lat, label: input.name};
					routing.addWaypointMarker (waypoint);

					// Add this item to recent searches
					routing.addToRecentSearches (waypoint);
					
				}, {totalWaypoints: totalWaypoints});
			});
		},

		// Function to add a waypoint to recent searches
		addToRecentSearches: function (waypoint) 
		{
			// Read the recent searches from a cookie, or initialise a new array if none are saved
			_recentSearches = ($.cookie ('recentSearches') ? $.parseJSON($.cookie('recentSearches')) : []);
		
			// Get location from input geocoder and add it to the waypoint dictionary
			waypoint['location'] = $('.panel.journeyplanner.search input[name="' + waypoint.label + '"]').val ();
			
			// If we don't have a location, don't save this as a recent search, and exit
			if (typeof waypoint['location'] === "undefined") {
				return;
			}
			
			// Add this to the _recentSearches array, and update the cookie
			_recentSearches.push (waypoint);
			$.cookie('recentSearches', JSON.stringify(_recentSearches));
			
			routing.buildRecentSearches ();
		},

		// Getter for _recentSearches
		getRecentSearches: function () 
		{
			// Read the recent searches from a cookie, or initialise a new array if none are saved
			_recentSearches = ($.cookie ('recentSearches') ? $.parseJSON($.cookie('recentSearches')) : []);

			return _recentSearches;
		},


		// Function to read the recent searches stored in a cookie, and populate the search panel
		buildRecentSearches: function () 
		{
			// Read the recent searches from a cookie, or initialise a new array if none are saved
			_recentSearches = ($.cookie ('recentSearches') ? $.parseJSON($.cookie('recentSearches')) : []);

			// Construct HTML for each search
			var html = '';
			if (_recentSearches.length) { // If there are recent searches
				$.each (_recentSearches, function (index, searchObject) { 
					html += '<li class="recentSearch"><a href="#" title="Add this waypoint to your journey"><img src="/images/icon-add-waypoint.svg" alt="Add this to your journey" /></a>';
					html += '<p class="destination">' + searchObject.location + '</p>';
					html += '</li><hr />';
				});
			} else {
				html += '<li><p class="address">Your recent searches will appear here.</p></li>';
			}
			
			// Append this to the journey search card
			$('.recent-searches').empty ();
			$('.recent-searches').append (html);

		},


		// Function to add a search to recent journeys cookie
		addToRecentJourneys: function ()
		{
			// Read the recent journeys from a cookie, or initialise a new array if none are saved
			_recentJourneys = ($.cookie ('recentJourneys') ? $.parseJSON($.cookie('recentJourneys')) : []);
			
			// Find the first and last input values, which contains the geocoded destination
			var origin = $('.panel.journeyplanner.search input').first().val();
			var destination = $('.panel.journeyplanner.search input').last().val();
			var waypoints = routing.getWaypoints ();

			// Build the journey object
			var journey = 
			{
				'origin': origin,
				'destination': destination,
				'waypoints': waypoints
			}

			// Add this to the _recentJourneys array, and update the cookie
			_recentJourneys.push (journey);
			$.cookie('recentJourneys', JSON.stringify(_recentJourneys));

			// Update the UI
			routing.buildRecentJourneys ();
		},

		// Getter for _recentJourneys
		getRecentJourneys: function () 
		{
			// Read the recent journeys from a cookie, or initialise a new array if none are saved
			_recentJourneys = ($.cookie ('recentJourneys') ? $.parseJSON($.cookie('recentJourneys')) : []);
			
			return _recentJourneys;
		},



		// Function to read the recent journeys stored in a cookie, and populate the search panel
		buildRecentJourneys: function () 
		{
			// Read the recent journeys from a cookie, or initialise a new array if none are saved
			_recentJourneys = ($.cookie ('recentJourneys') ? $.parseJSON($.cookie('recentJourneys')) : []);

			// Construct HTML for each journey
			var html = '';
			if (_recentJourneys.length) { // If there are recent journeys
				$.each (_recentJourneys, function (index, journeyObject) { 
					html += '<li class="getRecentJourneyDirections"><a href="#" title="Get directions to here"><img src="/images/btn-get-directions-small.svg" alt="Arrow pointing to the right" /></a>';
					html += '<p class="destination">' + journeyObject.destination + '</p>';
					html += '<p class="distance">7 miles</p>';
					html += '<p class="address">from ' + journeyObject.origin + '</p>';
					html += '</li><hr />';
				});
			} else {
				html += '<li><p class="address">Your recent journeys will appear here.</p></li>';
			}
			
			// Append this to the journey search card
			$('.recent-journeys').empty ();
			$('.recent-journeys').append (html);

		},
		
		// Function run at startup to register add and remove waypoint handler
		registerWaypointHandlers: function ()
		{			
			$('.panel.journeyplanner.search').on('click', 'a.removeWaypoint', function(e) {
				routing.removeWaypointGeocoder(e.target);
			});

			$('.panel.journeyplanner.search').on('click', 'a.addWaypoint', function(e) {
				routing.addWaypointGeocoder(e.target);
			});

			// Make journey planner inputs sortable via drag and drop
			$('#journeyPlannerInputs').sortable({
				items: '.inputDiv',
				forcePlaceholderSize: true,
				helper: 'original',
				opacity: 0.5,
				revert: 250,
				axis: "y"
			});

			// Disable the waypoints when list item is moved
			$('#journeyPlannerInputs').on("sort", function(event, ui) {
				$('.removeWaypoint').hide();
				$('.addWaypoint').hide(250);
			} );

			// Update the waypoints when list item is dropped
			$('#journeyPlannerInputs').on('sortstop', function(event, ui) {
				routing.sortWaypoints ();
			} );
		},

		sortWaypoints: function ()
		{
			// Save a copy of the old waypoints, and start a fresh _waypoints
			var oldWaypoints = _waypoints;
			_waypoints = []

			// Get all the input divs in their new order
			var inputDivs = $('.inputDiv');
			var arrayPosition = 0 // Keep track of where we are in the new waypoints array, i.e., for traffic light colours

			$(inputDivs).each (function(index, inputDiv) {
				// Get the input child of each div
				var inputWaypointName = $(inputDiv).children('input').attr('name');

				// Get the matching waypoint
				// If this geocoder has a contributed to a waypoint, find it
				var waypointIndex = oldWaypoints.findIndex(wp => wp.label == inputWaypointName);
				if (waypointIndex > -1) {
					var waypoint = oldWaypoints[waypointIndex];

					// Add new waypoint to our waypoints array
					_waypoints.push(waypoint);

					// Get a matching marker by lat and long, and change it to the appropriate colour
					var markerIndex = _markers.findIndex(marker => marker._lngLat.lng == waypoint.lng && marker._lngLat.lat == waypoint.lat);
					if (markerIndex > -1) {
						var markerElement = _markers[markerIndex]._element;
						var markerImage;
						switch (arrayPosition) {
							case 0:
								markerImage = _settings.images.start;
								break;
							case (inputDivs.length-1):
								markerImage = _settings.images.finish;
								break;
							default:
								markerImage = _settings.images.waypoint;
						}

						markerElement.style.backgroundImage = "url('" + markerImage + "')";
					} 
				}

				arrayPosition += 1;
			});
			
			// Update traffic light remove buttons and
			// rebuild the waypoint add buttons (attach to all inputs except end)
			var inputDivs = $('.inputDiv');
			var totalDivs = inputDivs.length;
			$('.addWaypoint').hide ();
			$(inputDivs).each (function(index, div) {
				// Set the appropriate traffic light colour and show add waypoint
				switch (index) {
					case 0:
						$(div).children('a.removeWaypoint').find('img').attr('src', '/images/btn-clear-field-green.svg');
						$(div).children('a.addWaypoint').show();
						$(div).children('span.loader').first().css('border-bottom-color', "#7ac064");
						break;
					case (totalDivs - 1): 
						$(div).children('a.removeWaypoint').find('img').attr('src', '/images/btn-clear-field-red.svg');
						$(div).children('span.loader').first().css('border-bottom-color', "#e54124");
						break;
					default: 
						$(div).children('a.removeWaypoint').find('img').attr('src', '/images/btn-clear-field-amber.svg');
						$(div).children('a.addWaypoint').show();
						$(div).children('span.loader').first().css('border-bottom-color', "#f8d147");
				}
			});
			
			// Show the rebuilt waypoint traffic lights
			$('.removeWaypoint').show(300);
		},

		// Add a geocoder input at a certain position 
		addWaypointGeocoder: function (waypointElement)
		{			
			
			// Increment current waypoint index
			_currentWaypointIndex += 1;
			var inputName = 'waypoint' + _currentWaypointIndex 
			
			var divHtml = routing.getInputHtml (inputName)
			
			// Append this HTML to the waypoint element div
			$(waypointElement).parent().parent().after(divHtml);

			// Register a handler for geocoding, attachable to any input
			routing.geocoder ('.panel.journeyplanner.search input[name="' + inputName + '"]', function (item, callbackData) {
			
				// Add the waypoint marker
				var waypoint = {lng: item.lon, lat: item.lat, label: inputName};
				routing.addWaypointMarker (waypoint);
				
			}, {_currentWaypointIndex: _currentWaypointIndex});

			// Resize map element
			cyclestreetsui.fitMap ();

			// Rescan and fix colour
			routing.sortWaypoints();
		},

		// Helper function to construct a geocoder input HTML + waypoint elements
		getInputHtml: function (inputName, inputHasDefaultValue = false) 
		{
			// Append the new input
			var newInputHtml = '';
			if (inputHasDefaultValue) {
				newInputHtml += '<input name="' + inputName +'" type="text" spellcheck="false" value="Finding location..." class="geocoder" placeholder="Add a waypoint, or click the map" value="" />';
			} else {
				newInputHtml += '<input name="' + inputName +'" type="text" spellcheck="false" class="geocoder" placeholder="Add a waypoint, or click the map" value="" />';
			}
			
			// Add the spinner
			newInputHtml += '<span class="loader"></span>';
			
			// Add a remove waypoint button
			var removeWaypointButtonHtml = '<a class="removeWaypoint" href="#" ><img src="/images/btn-clear-field-amber.svg" alt="Remove waypoint" /></a>'
			newInputHtml += removeWaypointButtonHtml

			// Add a add waypoint button
			var addWaypointButtonHtml = '<a class="addWaypoint" href="#" title="Add waypoint"><img src="/images/icon-add-waypoint.svg" alt="Add waypoint" /></a>';
			newInputHtml += addWaypointButtonHtml;

			// Add a reorder handle	
			var reorderWaypointHtml = '<a class="reorderWaypoint" href="#" title="Reorder waypoint"><img src="/images/icon-reorder.svg" /></a>';
			newInputHtml += reorderWaypointHtml;
			
			// Wrap this in a inputDiv div
			var divHtml = '<div class="inputDiv">' + newInputHtml + '</div>';

			return divHtml;
		},

		// Function to remove a geocoder input
		removeWaypointGeocoder: function (waypointElement)
		{
			// Get the container of this input (img> a.removeWaypoint > div.inputDiv)
			var divContainer = $(waypointElement).parent().parent();

			// Get the waypoint name from the input
			var inputElementName = $(waypointElement).parent().siblings('input').first().attr('name');

			// Only delete the actual input if we have > 2 inputs left
			if ($('.inputDiv').length > 2) {
				$(divContainer).remove();
			} else {
				// Delete any waypoint text in the input
				$(waypointElement).parent().siblings('input').first().val ('');
			}

			// If this geocoder has a contributed to a waypoint, find it
			var waypointIndex = _waypoints.findIndex(wp => wp.label == inputElementName);
			var waypoint = _waypoints[waypointIndex];
			
			// Remove any markers with the lngLat of the _waypoint
			var markerIndex = _markers.findIndex(marker => marker._lngLat.lng == waypoint.lng && marker._lngLat.lat == waypoint.lat);
			if (markerIndex > -1) {
				_markers[markerIndex].remove();
			} 

			// Remove the waypoint from waypoints array
			_waypoints.splice(waypointIndex, 1);

			// Enable or disale route planning button
			routing.enableOrDisableRoutePlanningButton ();

			// Rescan and fix colour
			routing.sortWaypoints ();

			// Resize map element
			cyclestreetsui.fitMap ();

		},
		
		// Function to add a route planning UI
		routePlanning: function (createHtml)
		{
			
			// Attach the route planning UI either to the Card UI (for mobile) or to the bottom-right of the map (for desktop)
			if (_isMobileDevice) {
				$('#cardcontent').append ('<div id="routeplanning"></div>');
			} else {
				var control = routing.createControl ('routeplanning', 'bottom-right');
			}
			
			// Add title
			var html = '<h2>Route planner</h2>';
			$('#routeplanning').append (html);
		
			// Add or assign input widgets
			var totalWaypoints = 2;
			var waypointName;
			var label;
			var waypointNumber;
			var input;
			var point;
			for (waypointNumber = 0; waypointNumber < totalWaypoints; waypointNumber++) {
				
				// Set the label
				switch (waypointNumber) {
					case 0: label = 'Start'; break;
					case (totalWaypoints - 1): label = 'Finish'; break;
					default: label = 'Waypoint';
				}
				
				// Create the input widget and attach a geocoder to it
				waypointName = 'waypoint' + waypointNumber;
				input = '<p><input name="' + waypointName + '" type="search" placeholder="' + label + '" class="geocoder" /></p>';
				$('#routeplanning').append (input);
				
				//var routeplanningInput = '#routeplanning input[name="' + waypointName + '"]';
	
			}
			
			// Register a handler for geocoding, attachable to any input
			routing.geocoder ('#routeplanning input[name="waypoint0"]', function (item, callbackData) {
				
				// Fire a click on the map
				// #!# Note that use of map.fire is now deprecated: https://gis.stackexchange.com/a/210289/58752
				point = _map.project ([item.lon, item.lat]);	// https://github.com/mapbox/mapbox-gl-js/issues/5060
				_map.fire ('click', { lngLat: {lng: item.lon, lat: item.lat} }, point);
				
				// Move focus to next geocoder input box if present
				//routing.focusFirstAvailableGeocoder (totalWaypoints);
				
			}, {totalWaypoints: totalWaypoints});


			// Put focus on the first available geocoder
			if (!_isMobileDevice) {
				routing.focusFirstAvailableGeocoder (totalWaypoints);
			}
		},
		
		
		// Helper function to put focus in the first available geocoder control
		focusFirstAvailableGeocoder: function (totalWaypoints)
		{
			// Loop through each available slot
			var waypointName;
			var element;
			var waypointNumber;
			for (waypointNumber = 0; waypointNumber < totalWaypoints; waypointNumber++) {
				
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
			var waypointName = 'waypoint' + (waypointNumber);
			var element = '.panel.journeyplanner input[name="' + waypointName + '"]';
			if ($(element).length) {
				$(element).val (name);
			}
		},
		
		
		// Function to initialise the routing UI
		routingInit: function ()
		{
			// Load initially
			routing.routing ();
			
			// Load routing when style ready or when style changed - the whole application logic is wrapped in this, as the entire state must be recreated if the style is changed
			$(document).on ('style-changed', function (event) {
				routing.routing ();
			});
		},
		
		// Add a pin to the map center, used only at start when clicking to open the map card to initialise JP
		addMapCenter: function ()
		{
			var center = _map.getCenter();
			
			// Register the waypoint
			// This overwrites any existing waypoints
			var waypoint = {lng: center.lng, lat: center.lat, label: 'waypoint0'};
				
			// Add the waypoint marker
			routing.addWaypointMarker (waypoint);

		},
		
		// Function to add the routing
		routing: function ()
		{
			// If the route is already loaded, show it
			if (!$.isEmptyObject (_routeGeojson)) {
				
				// Add the route for each strategy, and end
				$.each (_settings.strategies, function (index, strategy) {
					routing.showRoute (_routeGeojson[strategy.id], strategy);
				});
				
				// Add results tabs
				routing.resultsTabs ();
				
				return;
			}
			
			// Get map locations
			// https://www.mapbox.com/mapbox-gl-js/example/mouse-position/
			var totalWaypoints;
			
			// Handler for clicking on the map and adding a waypoint
			_map.on ('click', function (e) {
				
				// Take no action on the click handler if a route is loaded
				if (!$.isEmptyObject (_routeGeojson)) {return;}
				
				// Build the waypoint
				var waypoint = {lng: e.lngLat.lng, lat: e.lngLat.lat, label: null /* i.e., autodetermine label */};
				
				// If we are in singleMarkerMode, i.e., setting a home/work location, redirect to the function
				if (_singleMarkerMode) {
					var locationName = cyclestreetsui.getSettingLocationName (); // i.e., 'home', 'work'
					routing.setFrequentLocation (waypoint, locationName);
				}

				// Add the waypoint marker
				// This will fill the first empty inputs, then if none are empty, add an input
				var addInput = true
				routing.addWaypointMarker (waypoint, addInput);

				// Load the route if it is plannable, i.e. once there are two waypoints
				// Loading routeon map click is a setting an can be disable
				if (_settings.planRoutingOnMapClick) {
					routing.plannable ();
				}
			});
		},


		// Drop marker at user's geolocation
		setMarkerAtUserLocation: function ()
		{
			// Immediately set the value of the input box
			// This is so any other markers dropped in quick sucession will know that this box is 
			// going to be filled, once the AJAX call completes
			$('.panel.journeyplanner input.locationTracking').first ().val ('Finding your location...');
			
			// Retrieve the geolocatuon from layerviewer
			var geolocation = layerviewer.getGeolocation ();
			var geolocationLngLat = geolocation._accuracyCircleMarker._lngLat;

			// Build the waypoint to be "dropped" into map
			var waypoint = {lng: geolocationLngLat.lng, lat: geolocationLngLat.lat, label: 'waypoint0'};
			routing.addWaypointMarker (waypoint);
		},

		// Setter for _singleWaypointMode, accessed externally
		setSingleMarkerMode: function (boolean) 
		{
			_singleMarkerMode = boolean;
			return _singleMarkerMode;
		},


		// Getter for single marker location, used when setting home/work location
		getSingleMarkerLocation: function ()
		{
			return _singleMarkerLocation;
		},
		
		// Function to load a route if it is plannable from the registered waypoints, each containing a lng,lat,label collection
		plannable: function ()
		{
			// End if we have less than 2 waypoints
			if (_waypoints.length < 2) {return;}
			
			// Convert waypoints to strings
			var waypointStrings = routing.waypointStrings (_waypoints, 'lng,lat');
			
			// Add results tabs
			routing.resultsTabs ();
			
			// Load the route for each strategy
			var parameters = {};
			var url;
			$.each (_settings.strategies, function (index, strategy) {
				
				// If another routing engine is defined, define the request URL
				if (strategy.routeRequest) {
					url = strategy.routeRequest (waypointStrings, strategy.baseUrl, strategy.parameters);
					
				// Otherwise use the standard CycleStreets implementation
				} else {
					parameters = $.extend (true, {}, strategy.parameters);	// i.e. clone
					parameters.key = _settings.apiKey;
					parameters.waypoints = waypointStrings.join ('|');
					parameters.archive = 'full';
					parameters.itineraryFields = 'id,start,finish,waypointCount';
					parameters.journeyFields = 'path,plan,lengthMetres,timeSeconds,grammesCO2saved,kiloCaloriesBurned';
					url = _settings.apiBaseUrl + '/v2/journey.plan' + '?' + $.param (parameters, false);
				}
				
				// Load the route
				//console.log (url);
				routing.loadRoute (url, strategy);
			});
		},
		
		
		// Function to convert waypoints to strings
		waypointStrings: function (waypoints, order)
		{
			var waypointStrings = [];
			var waypointString;
			$.each (waypoints, function (index, waypoint) {
				if (order == 'lng,lat') {
					waypointString = parseFloat (waypoint.lng).toFixed(6) + ',' + parseFloat (waypoint.lat).toFixed(6);
				} else {
					waypointString = parseFloat (waypoint.lat).toFixed(6) + ',' + parseFloat (waypoint.lng).toFixed(6);
				}
				waypointStrings.push (waypointString);
			});
			return waypointStrings;
		},
		
		
		// Function to create result tabs; see: https://jqueryui.com/tabs/
		resultsTabs: function ()
		{
			// Remove any current content
			$('#results').remove ();
			
			// Add a link to clear the route
			//var clearRouteHtml = '<p><a id="clearroute" href="#">Clear route &hellip;</a></p>';
			
			// Create tabs and content panes for each of the strategies
			var tabsHtml = '<ul id="strategies">';
			var contentPanesHtml = '<div id="itineraries">';
			var rgb;
			$.each (_settings.strategies, function (index, strategy) {
				rgb = routing.hexToRgb (strategy.lineColour);
				tabsHtml += '<li><a data-strategy="' + strategy.id + '" href="#' + strategy.id + '" style="background-color: rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + '0.3' + ');"><label>' + routing.htmlspecialchars (strategy.label).replace('route', '') + '</label></a></li>';
				contentPanesHtml += '<div id="' + strategy.id + '"><p>Routing loading&hellip;</p></div>';
			});
			tabsHtml += '</ul>';
			contentPanesHtml += '</div>';
			
			// Assemble the HTML
			//var html = clearRouteHtml + tabsHtml + contentPanesHtml;
			var html = tabsHtml + contentPanesHtml;
			
			// Surround with a div for styling
			html = '<div id="results">' + html + '</div>';
			
			// Append the panel to the route planning UI
			$('#resultsTabs').append (html);
			
			// Add jQuery UI tabs behaviour
			$('#results').tabs ();
			
			// Select the default tab
			$('#results').tabs ('option', 'active', _routeIndexes[_selectedStrategy]);
			
			// On switching tabs, change the line thickness; see: https://stackoverflow.com/a/43165165/180733
			$('#results').on ('tabsactivate', function (event, ui) {
				var newStrategyId = ui.newTab.attr ('li', 'innerHTML')[0].getElementsByTagName ('a')[0].dataset.strategy;	// https://stackoverflow.com/a/21114766/180733
				_map.setPaintProperty (newStrategyId, 'line-width', _settings.lineThickness.selected);
				if (_settings.lineOutlines) {
					_map.setPaintProperty (newStrategyId + '-outline', 'line-width', _settings.lineThickness.selectedOutline);
				}
				routing.setSelectedStrategy (newStrategyId);
				var oldStrategyId = ui.oldTab.attr ('li', 'innerHTML')[0].getElementsByTagName ('a')[0].dataset.strategy;
				_map.setPaintProperty (oldStrategyId, 'line-width', _settings.lineThickness.unselected);
				if (_settings.lineOutlines) {
					_map.setPaintProperty (oldStrategyId + '-outline', 'line-width', _settings.lineThickness.unselected);
				}
				
				// Set keyboard focus away from the tabs, to enable keyboard navigation of the route; see: https://stackoverflow.com/questions/23241606/
				ui.newTab.blur ();
			});

		},
		
		
		// Function to set a new selected strategy
		setSelectedStrategy: function (newStrategyId)
		{
			// Register the defined strategy
			_selectedStrategy = newStrategyId;
			
			// Set a cookie, for a future page reload, to pick up the new default
			routing.setCookie ('selectedstrategy', newStrategyId, 14);
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
			return (result ? {
				r: parseInt (result[1], 16),
				g: parseInt (result[2], 16),
				b: parseInt (result[3], 16)
			} : null);
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
			if (colours[colour.toLowerCase()] !== undefined) {
				return colours[colour.toLowerCase()];
			}
			
			// Else pass through as-is
			return colour;
		},
		
		
		// Function to create an itinerary listing from the loaded route data
		itineraryListing: function (strategy, geojson)
		{
			// Start the HTML
			var html = '';

			// Add the journey stats, like distance, calories, etc
			var timeFormatted = routing.formatDuration (geojson.properties.plans[strategy.id].time);
			var distanceFormatted = routing.formatDistance (geojson.properties.plans[strategy.id].length);
			
			html += '<p class="location">' + geojson.properties.start + ' to ' + geojson.properties.finish + '</p>';
			
			html += '<ul class="journeyStats">';
			html += '<li><img src="/images/icon-cyclist.svg" alt="Icon of a cyclist" /><p> ' + distanceFormatted + '</p>';
			html += '<li><img src="/images/icon-clock.svg" alt="Clock icon" /><p> ' + timeFormatted + 'in</p></li>';
			html += '<li><img src="/images/icon-flame.svg" alt="Flame icon" /><p> ' + geojson.properties.plans[strategy.id].kiloCaloriesBurned + ' calories</p></li>';
			html += '<li><img src="/images/icon-leaf.svg" alt="Leaf icon" /><p> ' + geojson.properties.plans[strategy.id].grammesCO2saved + ' g</p></li>';
			html += '</ul>';

			html += '<div class="elevation-chart-container"><canvas id="' + strategy.id + 'elevationChart"></canvas></div>';
			html += '<span class="elevation"><img src="/images/icon-elevation.svg" alt="Elevation icon" />32m elevation</span>';
			html += '<a href="#" class="elevation-scrubber"><img src="/images/elevation-dragger.svg" alt="Dragger icon" /></a>';

			// Loop through each feature
			var segmentsIndex = {};
			var segment = 0;
			html += '<table class="itinerary lines strategy-' + strategy.id + '">';
			$.each (geojson.features, function (index, feature) {
				
				// Skip non-streets
				if (!feature.properties.path.match (/street/)) {return 'continue';}
				
				// Register this row in the segment index, starting from 1
				segment++;
				segmentsIndex[segment] = index;
				
				// Add this row
				html += '<tr data-segment="' + segment + '">';
				html += '<td class="travelmode">' + routing.travelModeIcon (feature.properties.travelMode, strategy.id) + '</td>';
				html += '<td>' + routing.turnsIcon (feature.properties.startBearing) + '</td>';
				html += '<td><strong>' + routing.htmlspecialchars (feature.properties.name) + '</strong></td>';
				html += '<td>' + feature.properties.ridingSurface + '</td>';
				html += '<td>' + routing.formatDistance (feature.properties.lengthMetres) + '</td>';
				html += '<td>' + routing.formatDuration (feature.properties.timeSeconds) + '</td>';
				html += '</tr>';
			});
			html += '</table>';
			
			// Save the last segment number
			var lastSegment = segment;
			
			// Set the content in the tab pane, overwriting any previous content
			$('#itineraries #' + strategy.id).html (html);
			
			// Add a tooltip to the tab, giving the main route details
			var title = strategy.label + ':\nDistance: ' + distanceFormatted + '\nTime: ' + timeFormatted;
			$('#strategies li a[data-strategy="' + strategy.id + '"]').attr ('title', title);
			
			// If a table row is clicked on, zoom to that section of the route (for that strategy)
			$('#itineraries table.strategy-' + strategy.id).on('click', 'tr', function (e) {
				var zoomToSegment = segmentsIndex[e.currentTarget.dataset.segment];
				routing.zoomToSegment (geojson, zoomToSegment);
				_keyboardFeaturePosition[strategy.id] = zoomToSegment;
			});
			
			// Make elevation scrubber draggable
			routing.elevationScrubber(geojson);

			// Generate elevation graph
			routing.generateElevationGraph(strategy.id, geojson);

			// Handle left/right keyboard navigation through the route, for this strategy
			routing.itineraryKeyboardNavigation (strategy.id, geojson, segmentsIndex, lastSegment);
		},


		// Function to initialise the elevation scrubber and to provide handlers for it
		elevationScrubber: function (geojson) 
		{
			$('.elevation-scrubber').draggable({
				axis: "x",
				containment: "parent",
				refreshPositions: true,
				drag: function (event, ui) {
					// Which chart are we dragging on, i.e., quietest, balanced
					var chartStrategyName = $(event.target).siblings('div').children('canvas').attr('id').replace('elevationChart', '');
					
					// Access that chart and get the element at X
					var mouseEvent = event.originalEvent.originalEvent;
					var activePoints = _elevationCharts[chartStrategyName].getElementsAtXAxis(mouseEvent);
					
					var chartIndex = activePoints[0]._index;
					var journeySegment = activePoints[0]._xScale.ticks[chartIndex];

					// Jump to segment
					routing.zoomToSegment(geojson, journeySegment);
				}
			});
		},


		// Function to write an elevation graph, used when generating the itinerary listing
		generateElevationGraph: function (strategyId, geojson) 
		{
			// We want to start on features[3], as the [0]-[2] don't contain elevation data
			var i = 3; // Start iterator
			var featuresLength = geojson.features.length;
			var elevationArray = []; // Initialise an empty array used to store the processed elevation data

			// Loop through all the features, and build a geometry array
			// The label corresponds to the segment, and the elevation is the value
			// As such, each label might correspond to multiple elevations, before we move on to the next segment
			var elevationObject = null;
			for (i; i < featuresLength; i++) {
				var elevationElements = geojson.features[i].properties.elevationsMetres;
				$(elevationElements).each(function (index, elevation) {
					// #¡# We should skip the repeated link elevations between indexes
					elevationObject = [i, elevation];
					elevationArray.push(elevationObject);
				});
			}

			// Build the data
			var elevationDataArray = [];
			var segmentDataArray = [];
			var segment = null;
			var elevation = null;
			$(elevationArray).each(function (index, elevation) {
				segment = elevation[0];
				elevation = elevation[1];
				segmentDataArray.push(segment);
				elevationDataArray.push(elevation);
			});

			// Display the elevation graph
			var canvas = document.getElementById(strategyId + 'elevationChart');
			var ctx = canvas.getContext('2d');
			_elevationCharts[strategyId] = new Chart(ctx, {
				type: 'line',
				data: {
					labels: segmentDataArray,
					datasets: [{
						label: 'Elevation',
						data: elevationDataArray,
						backgroundColor: 'rgba(220,79,85,1)'
					}]
				},
				options: {
					// On click, find the respective journey segment and zoom to that
					onClick: function (evt) {
						var activePoints = _elevationCharts[strategyId].getElementsAtXAxis(evt);
						var chartIndex = activePoints[0]._index;
						var journeySegment = activePoints[0]._xScale.ticks[chartIndex];

						// Jump to segment
						routing.zoomToSegment(geojson, journeySegment);
					},
					responsive: true,
					maintainAspectRatio: false,
					elements: {
						point: {
							radius: 0
						}
					},
					layout: {
						padding: {
							left: -10,
							right: 0,
							top: 0,
							bottom: -10
						}
					},
					legend: {
						display: false,
					},
					scales: {
						xAxes: [{
							ticks: {
								display: false
							},
							gridLines: {
								drawOnChartArea: false,
								drawBorder: true,
								display: false
							}
						}],
						yAxes: [{
							gridLines: {
								drawOnChartArea: false,
								drawBorder: true,
								display: false
							},
							ticks: {
								display: false
							}
						}]
					}
				}
			});
		},
		
		
		// Function to zoom to a specified feature
		zoomToSegment: function (geojson, segment)
		{
			var boundingBox = routing.getBoundingBox (geojson.features[segment].geometry.coordinates);
			_map.fitBounds (boundingBox, {maxZoom: _settings.maxZoomToSegment, animate: true, essential: true, duration: 500});	// Bounding box version of flyTo
		},
		
		
		// Function to determine the bounding box for a feature; see: https://stackoverflow.com/a/35685551/180733
		getBoundingBox: function (coordinates)
		{
			// Loop through the coordinates
			var bounds = {};
			var latitude;
			var longitude;
			var j;
			for (j = 0; j < coordinates.length; j++) {
				longitude = coordinates[j][0];
				latitude = coordinates[j][1];
				bounds.w = (bounds.w < longitude ? bounds.w : longitude);
				bounds.e = (bounds.e > longitude ? bounds.e : longitude);
				bounds.s = (bounds.s < latitude ? bounds.s : latitude);
				bounds.n = (bounds.n > latitude ? bounds.n : latitude);
			}
			
			// Return the bounds, in LngLatBoundsLike format; see: https://www.mapbox.com/mapbox-gl-js/api/#lnglatboundslike
			return [bounds.w, bounds.s, bounds.e, bounds.n];
		},
		
		
		// Function to provide keyboard navigation through an itinerary listing
		itineraryKeyboardNavigation: function (strategyId, geojson, segmentsIndex, lastSegment)
		{
			// Set initially as the whole route
			_keyboardFeaturePosition[strategyId] = 0;
			
			// Register a handler for keyboard navigation
			$(document).on ('keyup', function (event) {
				
				// Do not apply when inside an input field; see: https://stackoverflow.com/a/11112169/180733
				if (!$(event.target).is('input')) {
					
					// Take effect on only the currently-selected strategy's itinerary
					if (strategyId == _selectedStrategy) {
						
						// Detect keyboard key
						var key = event.which;
						if (key == 39 || key == 40) {	// right/down - move forward along the route
							_keyboardFeaturePosition[strategyId]++;
							if (_keyboardFeaturePosition[strategyId] > lastSegment) {_keyboardFeaturePosition[strategyId] = 0;}	// Wrap around to start if after end
						}
						if (key == 37 || key == 38) {	// left/up - move back along the route
							_keyboardFeaturePosition[strategyId]--;
							if (_keyboardFeaturePosition[strategyId] < 0) {_keyboardFeaturePosition[strategyId] = lastSegment;}	// Wrap around to end if before start
						}
						//console.log (_keyboardFeaturePosition);
						
						// Move to the selected feature, or the whole route if set to 0
						if (_keyboardFeaturePosition[strategyId] == 0) {
							routing.fitBoundsGeojson (geojson, strategyId);
						} else {
							routing.zoomToSegment (geojson, segmentsIndex[_keyboardFeaturePosition[strategyId]]);
						}
						
						// Prevent map movement / tab switching
						event.preventDefault ();
					}
				}
			});
		},
		
		
		// Function to convert a travel mode to an icon for the itinerary listing
		travelModeIcon: function (travelMode, strategy)
		{
			// Define the icons, using Unicode emojis
			var icons = {
				'walking':    '&#x1f6b6',	// https://emojipedia.org/pedestrian/
				'dismounted': '&#x1f6b6',	// https://emojipedia.org/pedestrian/
				'cycling':    '&#x1f6b2',	// https://emojipedia.org/bicycle/
				'driving':    '&#x1f697',	// https://emojipedia.org/automobile/
				'railway':    '&#xf683',	// https://emojipedia.org/railway-car/
				'horse':      '&#x1f40e'	// https://emojipedia.org/horse/
			};
			
			// Return the icon
			return icons[travelMode];
		},
		
		
		// Function to convert a bearing to an icon for the itinerary listing
		turnsIcon: function (bearing)
		{
			// Define the turns for each snapped bearing
			var turns = {
				'0':		'continue',
				'45':		'bear-right',
				'90':		'turn-right',
				'135':	'sharp-right',
				'180':	'u-turn',
				'235':	'sharp-left',
				'290':	'turn-left',
				'335':	'bear-left',
				'360':	'continue'
			};
			
			// Find the closest; see: https://stackoverflow.com/a/19277804/180733
			var bearings = Object.keys (turns);
			var closest = bearings.reduce (function (prev, curr) {
				return (Math.abs (curr - bearing) < Math.abs (prev - bearing) ? curr : prev);
			});
			
			// Set the icon
			var icon = turns[closest];
			
			// Assemble and return the HTML
			return '<span class="turnsicons turnsicon-' + icon + '"></span>';
		},
		
		
		// Function to format a distance
		formatDistance: function (metres)
		{
			// Convert Km
			var result;
			if (metres >= 1000) {
				var km = metres / 1000;
				result = Number (km.toFixed(1)) + 'km';
				return result;
			}
			
			// Round metres
			result = Number (metres.toFixed ()) + 'm';
			return result;
		},
		
		
		// Function to format a duration
		formatDuration: function (seconds)
		{
			// Calculate values; see: https://stackoverflow.com/a/16057667/180733
			var days = Math.floor (seconds / 86400);
			var hours = Math.floor (((seconds / 86400) % 1) * 24);
			var minutes = Math.floor (((seconds / 3600) % 1) * 60);
			seconds = Math.round (((seconds / 60) % 1) * 60);
			
			// Assemble the components
			var components = [];
			if (days) {components.push (days + ' ' + (days == 1 ? 'day' : 'days'));}
			if (hours) {components.push (hours + 'h');}
			if (minutes) {components.push (minutes + 'm');}
			if (!components.length) {
				components.push (seconds + 's');
			}
			
			// Assemble the string
			var result = components.join (', ');
			
			// Return the result
			return result;
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
				parameters.key = _settings.apiKey;
				parameters.id = itineraryId;
				parameters.itineraryFields = 'id,start,finish,waypointCount';
				url = _settings.apiBaseUrl + '/v2/journey.retrieve' + '?' + $.param (parameters, false);
				
				// Load the route
				routing.loadRoute (url, strategy);
			});
			
			// Add results tabs
			routing.resultsTabs ();
		},
		
		
		// Function to load a route over AJAX
		loadRoute: function (url, strategy)
		{
			// Load over AJAX; see: https://stackoverflow.com/a/48655332/180733
			$.ajax({
				dataType: 'json',
				url: url,
				success: function (result) {
					
					// Detect error in result
					if (result.error) {
						alert ('Sorry, the route for ' + strategy.label + ' could not be loaded: ' + result.error);
						return;
					}
					
					// If another routing engine is defined, convert its output format to emulate the CycleStreets GeoJSON format
					if (strategy.geojsonConversion) {
						result = strategy.geojsonConversion (result, strategy.id);
					}
					
					// For a single CycleStreets route, emulate /properties/plans present in the multiple route type
					if (!result.properties.plans) {
						result = routing.emulatePropertiesPlans (result, strategy.id);
					}
					
					// Register the GeoJSON to enable the state to persist between map layer changes and to set that the route is loaded
					_routeGeojson[strategy.id] = result;
					
					// Show the route
					routing.showRoute (_routeGeojson[strategy.id], strategy);
					
					// Set the itinerary number permalink in the URL
					var itineraryId = _routeGeojson[strategy.id].properties.id;
					routing.updateUrl (itineraryId, _waypoints);
					
					// Fit bounds
					routing.fitBoundsGeojson (_routeGeojson[strategy.id], strategy.id);
				},
				error: function (jqXHR, textStatus, errorThrown) {
					alert ('Sorry, the route for ' + strategy.label + ' could not be loaded.');
					console.log (errorThrown);
				}
			});
		},
		
		
		// Function to emulate /properties/plans present in the multiple route type but not the single type
		// #!# Needs to be fixed in the API V2 format
		emulatePropertiesPlans: function (result, strategyId)
		{
			// Find the relevant feature
			var findPath = 'plan/' + strategyId;
			var planIndex = false;
			$.each (result.features, function (index, feature) {
				if (feature.properties.path == findPath) {
					planIndex = index;
					return;	// i.e. break
				}
			});
			
			// Assemble the plan summaries
			var plans = {};
			plans[strategyId] = {		// Cannot be assigned directly in the array below; see https://stackoverflow.com/questions/11508463/javascript-set-object-key-by-variable
				length: result.features[planIndex].properties.lengthMetres,
				time: result.features[planIndex].properties.timeSeconds,
				grammesCO2saved: result.features[planIndex].properties.grammesCO2saved,
				kiloCaloriesBurned: result.features[planIndex].properties.kiloCaloriesBurned,
			};
			result.properties.plans = plans;
			
			// Return the result
			return result;
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
			// #!# padding values currently assume a large desktop screen
			_map.fitBounds (bounds, {padding: {top: 20, bottom: 20, left: 310, right: 380}});
			_map.setMaxZoom (_settings.maxZoom);	// Reset
		},
		
		
		// Function to render a route onto the map
		showRoute: function (geojson, strategy)
		{
			// Add in colours based on travel mode; see: https://www.mapbox.com/mapbox-gl-js/example/data-driven-lines/
			$.each (geojson.features, function (index, feature) {
				geojson.features[index].properties.color = routing.travelModeToColour (feature.properties.travelMode, strategy.lineColour);
			});
			
			// https://www.mapbox.com/mapbox-gl-js/example/geojson-line/
			// Data-driven styling support shown at: https://www.mapbox.com/mapbox-gl-js/style-spec/#layers-line
			var layer = {
				"id": strategy.id,
				"type": "line",
				"source": {
					"type": "geojson",
					"data": geojson,
					"attribution": strategy.attribution
				},
				"layout": {
					"line-join": "round",
					"line-cap": "round"
				},
				"paint": {
					"line-color": ['get', 'color'],
					"line-width": (strategy.id == _selectedStrategy ? _settings.lineThickness.selected : _settings.lineThickness.unselected)
				}
			};
			_map.addLayer (layer);
			
			// Add an outline for the line under the layer
			if (_settings.lineOutlines) {
				var outline = $.extend (true, {}, layer);	// i.e. clone
				outline.id += '-outline';
				outline.paint['line-color'] = (strategy.lineColourOutline || '#999');
				outline.paint['line-width'] = (strategy.id == _selectedStrategy ? _settings.lineThickness.selectedOutline : _settings.lineThickness.unselected);
				_map.addLayer (outline, strategy.id);
			}
			
			// Add a hover popup giving a summary of the route details, unless only one route is set to be shown at a time
			if (_settings.showAllRoutes) {
				routing.routeSummaryPopups (strategy, geojson.properties.plans[strategy.id], geojson);
			}
			
			// Set the route line to be clickable, which makes it the selected route, unless only one route is set to be shown at a time
			if (_settings.showAllRoutes) {
				routing.routeLineHighlighting (strategy.id);
			}
			
			// Add markers; this is only done once (using the exact endpoints of the selected strategy), to avoid re-laying markers and setting handlers multiple times
			if (strategy.id == _selectedStrategy) {
				routing.addRouteMarkers (geojson);
			}
			
			// Add the itinerary listing
			routing.itineraryListing (strategy, geojson);
		},
		
		
		// Function to map travel mode to colour
		travelModeToColour: function (travelMode, defaultValue)
		{
			// If supported, return the value
			if (_settings.travelModeColours[travelMode]) {
				return _settings.travelModeColours[travelMode];
			}
			
			// Otherwise return the default value
			return defaultValue;
		},
		
		
		// Function to add markers; see: https://www.mapbox.com/help/custom-markers-gl-js/
		addRouteMarkers: function (geojson)
		{
			// Clear any existing markers
			$.each (_markers, function (index, marker) {
				marker.remove();
			});
			_markers = [];
			_waypoints = [];
			
			// Determine the number of waypoints
			var totalWaypoints = 0;
			$.each (geojson.features, function (index, feature) {
				if (feature.properties.path.match (/^waypoint/)) {
					totalWaypoints++;
				}
			});
			
			// Add the marker for each point
			// #¡# Needs fixing to add the correct colours
			$.each (geojson.features, function (index, feature) {
				if (feature.properties.path.match (/^waypoint/)) {
					
					// Construct the marker attributes
					var label;
					switch (feature.properties.markerTag) {
						case 'start'       : label = 'waypoint0';  break;
						case 'finish'      : label = 'waypoint1'; break;
						case 'intermediate': label = false;                     break;
					}
					var waypoint = {lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1], label: label};
					
					// Add the marker
					routing.addWaypointMarker (waypoint);
				}
			});
			
			// For each marker, if moved, replan the route
			// https://www.mapbox.com/mapbox-gl-js/example/drag-a-marker/
			if (!$.isEmptyObject (_routeGeojson)) {
				$.each (_markers, function (index, marker) {
					_markers[index].on ('dragend', function (e) {
						// Update the waypoint in the registry
						_waypoints[index] = {lng: e.target._lngLat.lng, lat: e.target._lngLat.lat, label: _waypoints[index].label};
						
						// Remove the route for each strategy
						routing.removeRoute (true);
						
						// Load the route if it is plannable, i.e. once there are two waypoints
						routing.plannable ();
						
						// Remove the current handler and the other handlers for the other markers
						// See: https://stackoverflow.com/questions/21415897/removing-a-jquery-event-handler-while-inside-the-event-handler
						$(this).off ('dragend');
					});
				});
			}
		},
		
		
		// Function to add route summary popups; see: http://bl.ocks.org/kejace/356a4f31773a2edc9b1b1fec676bdfaf
		routeSummaryPopups: function (strategy, plan, geojson)
		{
			// Determine the location along the route to place the marker (e.g. if three strategies, place in the midpoint of the thirds of each route)
			var index = _routeIndexes[strategy.id];
			var totalStrategies = _settings.strategies.length;
			var fractionOfRoutePoint = (((index + (index + 1)) * 0.5) / totalStrategies);	// e.g. first strategy should be 1/6th of the way along the route
			var lengthUntilPoint = plan.length * fractionOfRoutePoint;
			
			// Iterate through the route to find the point along the route
			var length = 0;		// Start
			var coordinates;
			$.each (geojson.features, function (index, feature) {
				if (!feature.properties.path.match (/street/)) {return 'continue';}
				length += feature.properties.lengthMetres;
				if (length >= lengthUntilPoint) {
					coordinates = feature.geometry.coordinates[0];	// First within segment
					return false;	// break
				}
			});
			
			// Construct the HTML for the popup
			var html = '<div class="details" style="border-color: ' + strategy.lineColour + '">';
			html += '<ul><li><img src="/images/icon-clock.svg" alt="Clock icon" /><p>' + routing.formatDuration (plan.time) + '</p></li>';
			html += '<li><img src="/images/icon-cyclist.svg" alt="Cyclist icon" /><p>' + routing.formatDistance (plan.length) + '</p></li></ul>';
			html += '</div>';
			
			// Create the popup, set its coordinates, and add its HTML
			var popup = new mapboxgl.Popup ({
				closeButton: false,
				closeOnClick: false,
				className: 'strategypopup ' + strategy.id
			});
			popup.setLngLat (coordinates)
				.setHTML (html)
				.addTo (_map);
			
			// For this popup, set a handler when clicked on to switch to that strategy
			$('.strategypopup.' + strategy.id).on ('click', function (e) {
				routing.switchToStrategy (strategy.id);
			});
			
			// Register the popup to enable it to be deleted when the line is removed
			_popups[strategy.id] = popup;
		},
		
		
		// Function to set the route line to be clickable, which makes it the selected route
		routeLineHighlighting: function (strategyId)
		{
			// Add thickness on hover for this line; see: https://stackoverflow.com/questions/51039362/popup-for-a-line-in-mapbox-gl-js-requires-padding-or-approximate-mouse-over
			_map.on ('mousemove', strategyId /* i.e. the ID of the element being hovered on */, function (e) {
				_map.getCanvas().style.cursor = 'pointer';
				_map.setPaintProperty (strategyId, 'line-width', _settings.lineThickness.selected);
			});
			
			// Reset the line width, if it is was not already the originally-selected (thick) line
			_map.on ('mouseleave', strategyId, function () {
				_map.getCanvas().style.cursor = '';
				if (strategyId != _selectedStrategy) {
					_map.setPaintProperty (strategyId, 'line-width', _settings.lineThickness.unselected);
				}
			});
			
			// For this line, set a handler when clicked on to switch to that strategy
			_map.on ('click', strategyId, function (e) {
				routing.switchToStrategy (strategyId);
			});
		},
		
		
		// Function to switch to a different strategy
		switchToStrategy: function (strategyId)
		{
			// Set to be the selected strategy
			routing.setSelectedStrategy (strategyId);
			
			// Set to the thicker line style
			_map.setPaintProperty (strategyId, 'line-width', _settings.lineThickness.selected);
			
			// Switch to its tab
			$('#results').tabs ('option', 'active', _routeIndexes[strategyId]);
		},
		
		
		// Function to update the URL, to provide persistency when a route is present
		updateUrl: function (itineraryId, waypoints)
		{
			// End if not supported, e.g. IE9
			if (!history.pushState) {return;}
			
			// Default URL slug
			var urlSlug = '/';
			
			// Construct the URL slug from waypoints, if any
			if (waypoints) {
				var waypointStrings = routing.waypointStrings (waypoints, 'lat,lng');	// Lat,lng order is as used historically and is as per OSM, Google Maps
				urlSlug = '/journey/' + waypointStrings.join ('/') + '/';
			}
			
			// Construct the URL slug from an itinerary ID, which takes precedence
			if (itineraryId) {
				urlSlug = '/journey/' + itineraryId + '/';
			}
			
			// Construct the URL
			var url = '';
			url += urlSlug;
			url += window.location.hash;
			
			// Construct the page title, based on the enabled layers
			var title = _settings.title;
			if (itineraryId) {
				title += ': journey #' + itineraryId;
			}
			
			// Push the URL state
			history.pushState (urlSlug, title, url);
			document.title = title;		// Workaround for poor browser support; see: https://stackoverflow.com/questions/13955520/
		},
		
		
		// Function to remove a drawn route currently present
		removeRoute: function (retainWaypoints, keepMarkers = false)
		{
			// Remove the layer for each strategy
			$.each (_routeGeojson, function (id, routeGeojson) {
				_map.removeLayer (id);
				if (_settings.lineOutlines) {
					_map.removeLayer (id + '-outline');
				}
				_map.removeSource (id);
				if (_settings.lineOutlines) {
					_map.removeSource (id + '-outline');
				}
			});
			
			// Unset the route data
			_routeGeojson = {};
			
			// Clear any popups
			$.each (_popups, function (index, popup) {
				popup.remove();
			});

			// Clear any existing markers
			$.each (_markers, function (index, marker) {
				marker.remove();
			});
			_markers = [];
			
			// Redraw new markers and map them to the respective inputs
			if (keepMarkers) {
				// Reset the JP inputs to default state
				routing.resetJPGeocoderInputs ();

				// Redraw the markers from the waypoints
				// Save a copy of the waypoints index, as this will be rebuilt and matched to the new markers
				var routeWaypoints = _waypoints;
				_waypoints = [];
				_currentWaypointIndex = 0;
				$.each(routeWaypoints, function (indexInArray, waypoint) { 
					// Rename the label so it matches with the geocoder input name
					waypoint.label = 'waypoint' + _currentWaypointIndex;
					var addInput = true;
					var inputHasDefaultValue = true;
					routing.addWaypointMarker (waypoint, addInput, inputHasDefaultValue);
				});
			} 
			
			// Retain waypoints in memory if required
			if (!retainWaypoints) {
				_waypoints = [];
			}
			
			// Remove the itinerary ID
			_itineraryId = false;
			
			// Remove the result tabs if present
			$('#routeplanning #results').tabs ('destroy');	// http://api.jqueryui.com/tabs/
			$('#routeplanning #results').remove ();
			
			// Reparse the URL
			routing.parseUrl ();
			
			// Update the URL
			routing.updateUrl (_itineraryId, null);
		},


		// Function to remove all JP inputs
		resetJPGeocoderInputs: function ()
		{
			var inputElements = $('.panel.journeyplanner.search input');
			$.each (inputElements, function (index, inputElement) {
				$(inputElement).parent().remove();
				
			});
		},
		
		
		// Function to add a waypoint marker
		// Accepts arguments: addInput: it will forcefully add a new geocoder input
		// If addInput is false, an input will only be added if there is no empty existing input
		// inputHasDefaultValue: Creates the input with val="Finding location", to avoid a timing
		// error when many inputs are added at once and the geocoder doesn't have time to locate each one
		addWaypointMarker: function (waypoint, addInput = false, inputHasDefaultValue = false)
		{			
			// Auto-assign label if required
			if (waypoint.label == null) {
				// Is there an empty waypoint? If so, we want to associate this waypoint
				var isEmptyInput = false
				
				// Loop through all the inputs and find if there's an empty one
				var inputElements = $('.panel.journeyplanner.search input');
				$.each (inputElements, function (index, inputElement) {
					if (!$(inputElement).val()) {
						isEmptyInput = true;
						
						// If there is an empty input, use its waypointID
						waypoint.label = $(inputElement).attr('name');
						return false; // i.e., break and leave the loop
					}
				});
				
				// There was no empty input, so we need to increment the latest input
				if (!isEmptyInput) {
					waypoint.label = 'waypoint' + (_currentWaypointIndex+1);

					// If addInput wasn't enabled, enable it now, so we have a input for the new marker
					addInput = true;
				}
			}

			// Are we replacing a current waypoint, or registering a new one?
			// Search for a waypoint wht LngLat matching our new candidate
			var waypointIndex = _waypoints.findIndex(wp => wp.label == waypoint.label);
			
			// var waypointIndex will be -1 if not matched, of else returns index of match
			if (waypointIndex > -1) {
				// Store old waypoint
				var oldWaypoint = _waypoints[waypointIndex];
				
				// Replace the waypoint
				_waypoints[waypointIndex] = waypoint;
				
				// Locate the previous marker (at the old location), and setLngLat to new waypoint coordinates
				var markerIndex = _markers.findIndex(marker => marker._lngLat.lng == oldWaypoint.lng && marker._lngLat.lat == oldWaypoint.lat);
				if (markerIndex > -1) {
					_markers[markerIndex].setLngLat ([waypoint.lng, waypoint.lat]);
				} 

			} else { // We did not match any, so adding a new waypoint
				// Register the waypoint
				_waypoints.push (waypoint);
				
				// Get the final waypoint number
				if (waypoint.label) {
					var waypointNumber = Number(waypoint.label.replace('waypoint',''));
				}

				// Determine the image and text to use
				var image;
				var text;
				switch (waypointNumber) {
					case 0:
						image = _settings.images.start;
						break;
					case 1:
						image = _settings.images.finish;
						break;
					default:
						image = _settings.images.waypoint;
				}
				text = waypoint.label;
				
				// Assemble the image as a DOM element
				// Unfortunately Mapbox GL makes image markers more difficult than Leaflet.js and has to be done at DOM level; see: https://github.com/mapbox/mapbox-gl-js/issues/656
				var itinerarymarker = document.createElement('div');
				itinerarymarker.className = 'itinerarymarker';
				itinerarymarker.style.backgroundImage = "url('" + image + "')";
				
				// Add the marker
				var marker = new mapboxgl.Marker({element: itinerarymarker, offset: [0, -22], draggable: true})	// See: https://www.mapbox.com/mapbox-gl-js/api/#marker
					.setLngLat(waypoint)
					.setPopup( new mapboxgl.Popup({ offset: 25 }).setHTML(text) )
					.addTo(_map);
				
				// When marker is dragged, perform reverseGeocode and also update the waypoints
				marker.on ('dragend', function (e) {
					// Build waypoint
					var label = 'waypoint' + (waypointNumber);
					var waypoint = {lng: e.target._lngLat.lng, lat: e.target._lngLat.lat, label: label};
					
					// Find waypoint index
					var waypointIndex = _waypoints.findIndex(wp => wp.label == label);
					
					// Replace waypoint in _waypoints index
					_waypoints[waypointIndex] = waypoint;
					
					// Reverse geocode to fill input box
					routing.reverseGeocode (e.target._lngLat, waypointNumber);
				});

				// Register the marker
				_markers.push (marker);
				_currentWaypointIndex += 1;

				// Enable or disable route planning button
				routing.enableOrDisableRoutePlanningButton ();

				// If add input is enabled, add an input
				if (addInput) {
					// Is there an empty input? Add to this, instead
					var inputElements = $('.panel.journeyplanner.search input');
					var emptyInputExists = false;
					$.each (inputElements, function (index, inputElement) {
						if (!$(inputElement).val()) {
							emptyInputExists = true
							return false;
						}
					});
					

					if (!emptyInputExists) {
						var inputName = 'waypoint' + (waypointNumber) ;
						$('#journeyPlannerInputs').append (routing.getInputHtml (inputName, inputHasDefaultValue));
						
						// Register a handler for geocoding, attachable to any input
						routing.geocoder ('.panel.journeyplanner.search input[name="' + inputName + '"]', function (item, callbackData) {
									
							// Add the waypoint marker
							var waypoint = {lng: item.lon, lat: item.lat, label: inputName};
							routing.addToRecentSearches (waypoint);
							routing.addWaypointMarker (waypoint);
							
						}, {_currentWaypointIndex: _currentWaypointIndex});

						// Rescan and fix colour
						routing.sortWaypoints();
					}
				} 

				// After any additional input are created, perform the reverse geocode
				routing.reverseGeocode (waypoint, waypointNumber);
			}
		},


		/* 	Function to mark a single marker, i.e., house or work, or photomap upload location
			While in this mode, only one marker can be displayed on the screen
			If any Journey Planner markers were being displayed when this mode started, 
			they will be saved and restored after we have set the location
		*/
		setFrequentLocation: function (waypoint, type)
		{
			// Overwrite the marker location
			_singleMarkerLocation = [];
			_singleMarkerLocation.push (waypoint);

			// #¡# Add custom work/home markers?
			var image = _settings.images.start
			
			// Assemble the image as a DOM element
			var itinerarymarker = document.createElement('div');
			itinerarymarker.className = 'itinerarymarker';
			itinerarymarker.style.backgroundImage = "url('" + image + "')";
			
			// Add the marker
			var marker = new mapboxgl.Marker({element: itinerarymarker, offset: [0, -22], draggable: true})	// See: https://www.mapbox.com/mapbox-gl-js/api/#marker
				.setLngLat(waypoint)
				.addTo(_map);
			
			// Perform a reverse geocoding of the marker location initially 
			routing.reverseGeocode (waypoint, 'FrequentLocation'); // This overloads the reversegeocoder, which ties to input name 'waypoint' + waypointNumber
			
			// When marker is dragged, perform reverseGeocode and also update the waypoints
			marker.on ('dragend', function (e) {
				// Build waypoint
				var waypoint = {lng: e.target._lngLat.lng, lat: e.target._lngLat.lat, label: null};
				
				// Update the location of the single marker
				routing.setFrequentLocation (waypoint, type)
				
				// Reverse geocode to fill input box
				routing.reverseGeocode (e.target._lngLat, 'FrequentLocation'); // This overloads the reversegeocoder, which ties to input name 'waypoint' + waypointNumber
			});

			// Overwrite any other markers
			$.each(_markers, function (indexInArray, undesiredMarkers) { 
				undesiredMarkers.remove ();
			});
			_markers.push (marker);
		},


		// Function to reset the frequent location, used to reset this variable after operation is finihsed
		resetFrequentLocation: function ()
		{
			// Remove the single marker location
			_singleMarkerLocation = [];

			// Delete any markers
			$.each(_markers, function (indexInArray, undesiredMarkers) { 
				undesiredMarkers.remove ();
			});
		},
		
		
		// Function to reverse geocode a location
		reverseGeocode: function (coordinates, waypointNumber)
		{
			// Assemble API URL; see: https://www.cyclestreets.net/api/v2/nearestpoint/
			var reverseGeocoderApiUrl = routing.settingsPlaceholderSubstitution (_settings.reverseGeocoderApiUrl, ['apiBaseUrl', 'apiKey']);
			reverseGeocoderApiUrl += '&lonlat=' + coordinates.lng + ',' + coordinates.lat;
			
			// Divine the input element, which will be used to control the spinner loader
			var inputElement = $('.panel.journeyplanner.search input[name=waypoint' + waypointNumber + ']').first();

			// Fetch the result
			$.ajax({
				dataType: 'json',
				url: reverseGeocoderApiUrl,

				beforeSend: function (jqXHR, settings) {
					// Display a ui-autocomplete-loading on the element being located
					$(inputElement).addClass('ui-autocomplete-loading');
				},
				success: function (result) {

					// Detect error in result
					if (result.error) {
						routing.setGeocoderLocationName(false, waypointNumber);
						return;
					}
					// Set the location name
					routing.setGeocoderLocationName(result.features[0].properties.name, waypointNumber);
				},
				error: function (jqXHR, textStatus, errorThrown) {
					routing.setGeocoderLocationName(false, waypointNumber);
					console.log(errorThrown);
				},
				complete: function () {
					// Remove the spinner
					$(inputElement).removeClass ('ui-autocomplete-loading');
				}
			});
		},


		// Getter to access waypoints index
		getWaypoints: function ()
		{
			return _waypoints;
		},


		// Setter to replace waypoints index
		setWaypoints: function (waypoints)
		{
			_waypoints = waypoints;
		},
		
		
		// Function to make data entity-safe
		htmlspecialchars: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		},
		
		
		// Function to set a cookie; see: https://www.w3schools.com/js/js_cookies.asp
		setCookie: function (name, value, days)
		{
			var d = new Date ();
			d.setTime (d.getTime () + (days * 24 * 60 * 60 * 1000));
			var expires = 'expires=' + d.toUTCString();
			document.cookie = name + '=' + value + ';' + expires + ';path=/';
		},
		
		
		// Function to get a cookie's value; see: https://www.w3schools.com/js/js_cookies.asp
		getCookie: function (name)
		{
			var cname = name + '=';
			var decodedCookie = decodeURIComponent (document.cookie);
			var ca = decodedCookie.split (';');
			var i;
			var c;
			for (i = 0; i <ca.length; i++) {
				c = ca[i];
				while (c.charAt(0) == ' ') {
					c = c.substring(1);
				}
				if (c.indexOf (cname) == 0) {
					return c.substring (cname.length, c.length);
				}
			}
			return false;
		}
	};
	
} (jQuery));

