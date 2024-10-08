// Route planning / satnav user interface

/*jslint browser: true, white: true, single: true, for: true, long: true, unordered: true */
/*global $, jQuery, alert, console, window, history, confirm, prompt, mapboxgl, Chart, vex, autocomplete, satnav, layerviewer, cyclestreetsui */


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


const routing = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	const _settings = {
		
		// Title
		title: 'CycleStreets',
		
		// CycleStreets API
		apiBaseUrl: 'https://api.cyclestreets.net',
		apiKey: 'YOUR_CYCLESTREETS_API_KEY',
		
		// Target UI <div> paths, defined by the client code, which the library will populate
		plannerDivPath: '#routeplanning',
		mapStyleDivPath: '#layerswitcher',
		resultsContainerDivPath: '#resultstabspanel',
		
		// Whether to create planning controls, using plannerDivPath and resultsContainerDivPath (if simple divs, e.g. '#routeplanning')
		createPlanningControls: false,
		
		// Max zoom
		maxZoom: 17,
		maxZoomToSegment: 17,
		
		// Below this zoom level a mouse click zooms-in the map
		minimumZoomForStreetSelection: 13,
		
		// Geocoder API URL; re-use of settings values represented as placeholders {%apiBaseUrl}, {%apiKey}, {%autocompleteBbox}, are supported
		geocoderApiUrl:        '{%apiBaseUrl}/v2/geocoder?key={%apiKey}&bounded=1&bbox={%autocompleteBbox}',
		reverseGeocoderApiUrl: '{%apiBaseUrl}/v2/nearestpoint?key={%apiKey}',
		
		// BBOX for autocomplete results biasing
		autocompleteBbox: '-6.6577,49.9370,1.7797,57.6924',
		
		// Images
		// #!# Need a better way to handle these paths with baseUrl, and being able to set individually
		images: {
			
			// Waypoints; size set in CSS with .itinerarymarker
			start: '/images/itinerarymarkers/start.png',
			waypoint: '/images/itinerarymarkers/waypoint.png',
			finish: '/images/itinerarymarkers/finish.png',
			
			// Results container icons
			distance: '/images/resultscontainer/icon-cyclist.svg',
			time: '/images/resultscontainer/icon-clock.svg',
			calories: '/images/resultscontainer/icon-flame.svg',
			co2: '/images/resultscontainer/icon-leaf.svg',
			gpx: '/images/resultscontainer/icon-jp-red.svg'
		},
		
		// Initial route
		initialRoute: false,	// E.g. [[0.123902, 52.202968], [-0.127669, 51.507318]], as array of lon,lat pairs, or false to disable
		
		// Routing strategies, in order of appearance in the UI, and the default
		defaultStrategy: 'balanced',
		multiplexedStrategies: true,
		strategies: [
			{
				id: 'fastest',
				label: 'Fastest route',
				parameters: {plans: 'fastest'},
				lineColour: '#cc0000',
				lineColourOutline: 'red',
				gpx: true,
				attribution: 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
			},
			{
				id: 'balanced',
				label: 'Balanced route',
				parameters: {plans: 'balanced'},
				lineColour: '#ffc200',
				lineColourOutline: 'orange',
				gpx: true,
				attribution: 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
			},
			{
				id: 'quietest',
				label: 'Quietest route',
				parameters: {plans: 'quietest'},
				lineColour: '#00cc00',
				lineColourOutline: 'green',
				gpx: true,
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
				implementation: 'osrm',				// Implementation is assumed to be 'cyclestreets' unless otherwise stated; currently supported engines are 'cyclestreets' and 'osrm'
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
		
		// Padding for fit bounds
		fitBoundsPadding: {top: 20, bottom: 20, left: 310, right: 380},
		
		// Whether to show all route line results or just the currently-selected
		showAllRoutes: true,
		
		// Whether to plan routes the moment the map is clicked rather than wait until a routing button is pressed
		planRoutingOnMapClick: true,
		
		// Distance unit: kilometers/miles
		distanceUnit: 'kilometers',
		
		// Whether to show the basic Mapbox toolbox
		showToolBox: true,
		
		// Whether to prompt before clearing route
		promptBeforeClearingRoute: true,
		
		// Load Tabs class toggle, used when loading a parameterised URL. This CSS class will be added to the enabled parent li elements (i.e., 'checked', or 'selected')
		loadTabsClassToggle: 'enabled',
		
		// Element on which to display a routing "enabled" icon, while route is shown
		routingEnabledElement: null,
		
		// Travellable hours per day in result listing; e.g. could change to 8-hour days
		travellableHoursPerDay: 24
	};
	
	// Internal class properties
	let _map = null;
	let _isMobileDevice = false;
	let _urlParameters = {};
	let _itineraryId = null;
	let _waypoints = [];	// Ordered stack of waypoints, each with lng/lat/label
	let _markers = [];
	let _routeGeojson = {};
	let _panningEnabled = false;
	const _routeIndexes = {};
	const _popups = {};
	let _selectedStrategy = false;
	let _plannerDivId = null;
	const _keyboardFeaturePosition = {};
	let _currentWaypointIndex = 0; // We start with no waypoints in our index
	const _elevationCharts = {}; // Store the elevation charts as global, so we can access them through the scrubber
	const _elevationChartArray = {}; // Store the elevation data for different routing strategies
	let _singleMarkerMode = false; // Set when only one waypoint should be clickable on the map, i.e., when setting home/work location
	let _singleMarkerLocation = []; // Store the coordinates of a single waypoint, when setting work/home location
	let _recentJourneys = []; // Store the latest planned routes
	let _recentSearches = []; // Store recent searches, used to populate the JP card
	let _disableMapClicks = false; // Whether to ignore clicks on the map, useful for certain program states
	let _showPlannedRoute = false; // Don't display planned routes when we are not in itinerary mode, useful if the AJAX call takes a while and user has exited itinerary mode in the meantime
	let _speedKmph = '16'; // The maximum cycling speed for the journey, in km/h.
	let _inputDragActive = false; // Used to avoid conflict with swipe-down event on card
	let _loadingRouteFromId = false; // Used to publicly discern the routing mode
	
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
			
			// Set implementation to default if not present; assumed to be 'cyclestreets' unless otherwise stated
			$.each (_settings.strategies, function (index, strategy) {
				if (!strategy.hasOwnProperty ('implementation')) {
					_settings.strategies[index].implementation = 'cyclestreets';
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
			const strategyCookie = routing.getCookie ('selectedstrategy');
			_selectedStrategy = strategyCookie || _settings.defaultStrategy;
			
			// Add toolbox (pending implementation of overall UI)
			routing.toolbox ();
			
			// Add panning control
			//routing.controlPanning ();
			
			// Add route clearing
			routing.enableRouteClearing ();
			
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
			
			// If required, create route planning UI controls
			if (_settings.createPlanningControls) {
				routing.createRoutePlanningControls ();
			}
			
			// Connect existing inputs to geocoder autocomplete
			routing.connectGeocoders ();
			
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
		
		
		// Get drag status of inputs
		getInputDragStatus: function ()
		{
			return _inputDragActive;
		},
		
		
		// Function to create a control in a corner
		// See: https://www.mapbox.com/mapbox-gl-js/api/#icontrol
		createControl: function (id, position)
		{
			const myControl = function () {};
			
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
			const geocoderApiUrl = routing.settingsPlaceholderSubstitution (_settings.geocoderApiUrl, ['apiBaseUrl', 'apiKey', 'autocompleteBbox']);
			
			// Attach the autocomplete library behaviour to the location control
			autocomplete.addTo (addTo, {
				sourceUrl: geocoderApiUrl,
				select: function (event, ui) {
					const bbox = ui.item.feature.properties.bbox.split(',');
					_map.setMaxZoom (17);	// Prevent excessive zoom to give context
					_map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {duration: 1500});	// Note that Mapbox GL JS uses sw,ne rather than ws,en as in Leaflet.js
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
			$.each (supportedPlaceholders, function (index, field) {
				const placeholder = '{%' + field + '}';
				string = string.replace (placeholder, _settings[field]);
			});
			
			// Return the modified string
			return string;
		},
		
		
		// Function to parse the URL
		parseUrl: function ()
		{
			// Start a list of parameters
			const urlParameters = {};
			
			// Extract journey URL
			urlParameters.itineraryId = false;
			const matchesItinerary = window.location.pathname.match (/^\/journey\/([0-9]+)\/$/);
			if (matchesItinerary) {
				urlParameters.itineraryId = matchesItinerary[1];
			}
			
			// Extract journey URL
			urlParameters.waypoints = [];
			const matchesWaypoints = window.location.pathname.match (/^\/journey\/([-.0-9]+,[-.,\/0-9]+)\/$/);
			if (matchesWaypoints) {
				const waypointPairs = matchesWaypoints[1].split ('/');
				const waypoints = [];
				$.each (waypointPairs, function (index, waypointPair) {
					const matches = waypointPair.match (/^([-.0-9]+),([-.0-9]+)$/);
					if (matches) {
						const waypointLatLon = waypointPair.split (',');
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
			// End if not required
			if (!_settings.showToolBox) {return;}
			
			// Add layer switcher UI
			routing.createControl ('toolbox', 'bottom-left');
			
			// Determine whether route loading from ID is supported; for this, all engines need to be native CycleStreets type
			let routeLoadingSupported = true;
			$.each (_settings.strategies, function (index, strategy) {
				if (strategy.implementation != 'cyclestreets') {
					routeLoadingSupported = false;
					return false;	// Break
				}
			});
			
			// Construct HTML for layer switcher
			let html = '<ul id="toolbox">';
			if (routeLoadingSupported) {
				html += '<li><a id="loadrouteid" href="#">Load route ID &hellip;</a></li>';
			}
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
			const text = (_panningEnabled ? 'Panning: enabled' : 'Panning: disabled');
			$('#panning').text (text);
		},
		
		
		// Add a clear route handler
		enableRouteClearing: function ()
		{
			// Create a delegated click function to clear the route
			$('body').on('click', '#clearroute', function () {
				routing.clearRoute ();
			});
		},
		
		
		// Function to clear the route, markers, and waypoints
		clearRoute: function (retainWaypoints = true, keepMarkers = true)
		{
			// If a route is already loaded, prompt to remove it
			if (!$.isEmptyObject (_routeGeojson)) {
				if (_settings.promptBeforeClearingRoute) {
					if (!confirm ('Clear existing route?')) {
						return;
					}
				}
				
				// Remove the route for each strategy
				routing.removeRoute (retainWaypoints, keepMarkers);
			}
			
			// Remove any "enabled" selector
			if (_settings.routingEnabledElement !== null) {
				$(_settings.routingEnabledElement).removeClass (_settings.loadTabsClassToggle);
			}
			
			// Turn off route display, in case there are any slow/late incoming AJAX responses
			routing.plannedRouteShouldBeShown (false);
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
				$(_settings.plannerDivPath + ' #getRoutes').addClass ('grayscale', 1000).css ('opacity', '0.3');
			} else {
				$(_settings.plannerDivPath + ' #getRoutes').removeClass ('grayscale', 1000).css ('opacity', '1');
			}
		},
		
		
		// Function run at launch to hook inputs up to geocoder
		connectGeocoders: function ()
		{
			const journeyplannerInputs = $(_settings.plannerDivPath + ' input');
			const totalWaypoints = 2; // Default amount of waypoints, i.e. (0) Start and (1) Finish
			
			$.each (journeyplannerInputs, function (index, input) {
				
				// Register a handler for geocoding, attachable to any input
				routing.geocoder (_settings.plannerDivPath + ' input[name="' + input.name + '"]', function (item, callbackData) {
					
					// Add the waypoint marker
					const waypoint = {lng: item.lon, lat: item.lat, label: input.name};
					routing.addWaypointMarker (waypoint);
					
					// Add this item to recent searches
					routing.addToRecentSearches (waypoint);
					
					// Blur input
					document.activeElement.blur();
					
				}, {totalWaypoints: totalWaypoints});
			});
		},
		
		
		// Function to add a waypoint to recent searches
		addToRecentSearches: function (waypoint)
		{
			// Read the recent searches from a cookie, or initialise a new array if none are saved
			_recentSearches = ($.cookie ('recentSearches') ? $.parseJSON($.cookie('recentSearches')) : []);
			
			// Get location from input geocoder and add it to the waypoint dictionary
			waypoint.location = $(_settings.plannerDivPath + ' input[name="' + waypoint.label + '"]').val ();
			
			// If we don't have a location, don't save this as a recent search, and exit
			if (typeof waypoint.location === 'undefined') {return;}
			
			// Have we already got this location?
			// If so, we will move this location up the search stack up to first index
			const savedLocationIndex = _recentSearches.findIndex ((obj) => obj.location == waypoint.location);
			if (savedLocationIndex > -1) {
				const element = _recentSearches[savedLocationIndex];
				_recentSearches.splice(savedLocationIndex, 1);
				_recentSearches.splice(0, 0, element);
			} else {
				// Add this to the beginning of _recentSearches array
				_recentSearches.unshift (waypoint);
			}
			
			// Add this to the cookie, and rebuild the searches
			$.cookie ('recentSearches', JSON.stringify(_recentSearches));
			routing.buildRecentSearches ();
		},
		
		
		// Getter for _recentSearches
		getRecentSearches: function ()
		{
			// Read the recent searches from a cookie, or initialise a new array if none are saved
			_recentSearches = ($.cookie ('recentSearches') ? $.parseJSON($.cookie('recentSearches')) : []);
			
			return _recentSearches;
		},
		
		
		// Clear _recentSearches
		clearRecentSearches: function ()
		{
			// Reset _recent searches array, and write as a cookie
			_recentSearches = [];
			$.cookie ('recentSearches', JSON.stringify(_recentSearches));
			
			// Update the UI
			routing.buildRecentSearches ();
		},
		
		
		// Function to read the recent searches stored in a cookie, and populate the search panel
		buildRecentSearches: function ()
		{
			// Read the recent searches from a cookie, or initialise a new array if none are saved
			_recentSearches = ($.cookie ('recentSearches') ? $.parseJSON($.cookie('recentSearches')) : []);
			
			let html = '';
			if (_recentSearches.length) { // If there are recent searches
				$.each (_recentSearches, function (index, searchObject) {
					html += '<li class="recentSearch"><a href="#" title="Add this waypoint to your journey"><img src="/images/icon-add-waypoint.svg" alt="Add this to your journey" /></a>';
					html += '<p class="destination">' + searchObject.location + '</p>';
					html += '</li><hr />';
				});

				html += '<a class="clearRecentSearches" href="#" title="Clear recent searches">Clear recent searches</a>';
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
			const origin = $(_settings.plannerDivPath + ' input').first().val();
			const destination = $(_settings.plannerDivPath + ' input').last().val();
			const waypoints = routing.getWaypoints ();
			
			// Build the journey object
			const journey = {
				origin: origin,
				destination: destination,
				waypoints: waypoints
			};
			
			// Add this to the _recentJourneys array, and update the cookie
			_recentJourneys.push (journey);
			$.cookie('recentJourneys', JSON.stringify (_recentJourneys));
			
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
		
		
		// Clear _recentJourneys
		clearRecentJourneys: function ()
		{
			// Reset _recent journeys array, and write as a cookie
			_recentJourneys = [];
			$.cookie('recentJourneys', JSON.stringify(_recentJourneys));
			
			// Update the UI
			routing.buildRecentJourneys ();
		},
		
		
		// Function to read the recent journeys stored in a cookie, and populate the search panel
		buildRecentJourneys: function ()
		{
			// Read the recent journeys from a cookie, or initialise a new array if none are saved
			_recentJourneys = ($.cookie ('recentJourneys') ? $.parseJSON($.cookie('recentJourneys')) : []);
			
			// Construct HTML for each journey
			let html = '';
			if (_recentJourneys.length) { // If there are recent journeys
				$.each (_recentJourneys, function (index, journeyObject) {
					html += '<li class="getRecentJourneyDirections"><a href="#" title="Get directions to here"><img src="/images/btn-get-directions-small.svg" alt="Arrow pointing to the right" /></a>';
					html += '<p class="destination">' + journeyObject.destination + '</p>';
					html += '<p class="distance">7 miles</p>';
					html += '<p class="address">from ' + journeyObject.origin + '</p>';
					html += '</li><hr />';
				});

				html += '<a class="clearRecentJourneys" href="#" title="Clear recent journeys">Clear recent journeys</a>';
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
			$(_settings.plannerDivPath).on ('click', 'a.removeWaypoint', function(e) {
				routing.removeWaypointGeocoder(e.target);
			});
			
			$(_settings.plannerDivPath).on ('click', 'a.addWaypoint', function(e) {
				routing.addWaypointGeocoder(e.target);
			});
			
			// Make journey planner inputs sortable via drag and drop
			$('#journeyPlannerInputs').sortable ({
				items: '.inputDiv',
				forcePlaceholderSize: true,
				handle: '.reorderWaypoint',
				helper: 'original',
				opacity: 0.5,
				revert: 250,
				axis: 'y',
				start: function () {
					_inputDragActive = true;
				},
				stop: function (event, ui) {
					_inputDragActive = false;
				}
			});
			
			// Disable the waypoints when list item is moved
			$('#journeyPlannerInputs').on ('sort', function(event, ui) {
				$('.removeWaypoint').fadeOut ();
				$('.addWaypoint'). fadeOut (250);
			});
			
			// Update the waypoints when list item is dropped
			$('#journeyPlannerInputs').on ('sortstop', function(event, ui) {
				routing.sortWaypoints ();
			});
		},
		
		
		sortWaypoints: function ()
		{
			// Save a copy of the old waypoints, and start a fresh _waypoints
			const oldWaypoints = _waypoints;
			_waypoints = [];
			
			// Get all the input divs in their new order
			let inputDivs = $('.inputDiv');
			let arrayPosition = 0; // Keep track of where we are in the new waypoints array, i.e., for traffic light colours
			
			$(inputDivs).each (function (index, inputDiv) {
				// Get the input child of each div
				const inputWaypointName = $(inputDiv).children('input').attr('name');
				
				// Get the matching waypoint
				// If this geocoder has contributed to a waypoint, find it
				const waypointIndex = oldWaypoints.findIndex((wp) => wp.label == inputWaypointName);
				if (waypointIndex > -1) {
					const waypoint = oldWaypoints[waypointIndex];
					
					// Add new waypoint to our waypoints array
					_waypoints.push(waypoint);
					
					// Get a matching marker by lat and long, and change it to the appropriate colour
					const markerIndex = _markers.findIndex((marker) => marker._lngLat.lng == waypoint.lng && marker._lngLat.lat == waypoint.lat);
					if (markerIndex > -1) {
						const markerElement = _markers[markerIndex]._element;
						let markerImage;
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
			
			// Update traffic light remove buttons and rebuild the waypoint add buttons (attach to all inputs except end)
			inputDivs = $('.inputDiv');
			const totalDivs = inputDivs.length;
			$('.addWaypoint').hide ();
			$(inputDivs).each (function (index, div) {
				// Set the appropriate traffic light colour and show add waypoint
				switch (index) {
					case 0:
						$(div).children ('a.removeWaypoint').find ('img').attr ('src', '/images/btn-clear-field-green.svg');
						$(div).children ('a.addWaypoint').fadeIn ();
						$(div).children ('span.loader').first ().css('border-bottom-color', "#7ac064");
						break;
					case (totalDivs - 1):
						$(div).children ('a.removeWaypoint').find ('img').attr('src', '/images/btn-clear-field-red.svg');
						$(div).children ('span.loader').first ().css ('border-bottom-color', "#e54124");
						break;
					default:
						$(div).children ('a.removeWaypoint').find ('img').attr('src', '/images/btn-clear-field-amber.svg');
						$(div).children ('a.addWaypoint').fadeIn ();
						$(div).children ('span.loader').first ().css ('border-bottom-color', "#f8d147");
				}
			});
			
			// Show the rebuilt waypoint traffic lights
			$('.removeWaypoint').fadeIn ();
		},
		
		
		// Add a geocoder input at a certain position
		addWaypointGeocoder: function (waypointElement)
		{			
			// Increment current waypoint index
			_currentWaypointIndex += 1;
			const inputName = 'waypoint' + _currentWaypointIndex;
			
			const divHtml = routing.getInputHtml (inputName);
			
			// Append this HTML to the waypoint element div
			$(waypointElement).parent().parent().after(divHtml);
			
			// Register a handler for geocoding, attachable to any input
			routing.geocoder (_settings.plannerDivPath + ' input[name="' + inputName + '"]', function (item, callbackData) {
				
				// Add the waypoint marker
				const waypoint = {lng: item.lon, lat: item.lat, label: inputName};
				routing.addWaypointMarker (waypoint);
				
			}, {_currentWaypointIndex: _currentWaypointIndex});
			
			// Resize map element
			// #!# Global object not supplied - should use a handle instead
			cyclestreetsui.fitMap ();
			
			// Rescan and fix colour
			routing.sortWaypoints();
		},
		
		
		// Helper function to construct a geocoder input HTML + waypoint elements
		getInputHtml: function (inputName, inputHasDefaultValue = false)
		{
			// Append the new input
			let newInputHtml = '';
			if (inputHasDefaultValue) {
				newInputHtml += '<input name="' + inputName +'" type="text" spellcheck="false" value="Finding location..." class="geocoder" placeholder="Add a waypoint, or click the map" value="" />';
			} else {
				newInputHtml += '<input name="' + inputName +'" type="text" spellcheck="false" class="geocoder" placeholder="Add a waypoint, or click the map" value="" />';
			}
			
			// Add the spinner
			newInputHtml += '<span class="loader"></span>';
			
			// Add a remove waypoint button
			const removeWaypointButtonHtml = '<a class="removeWaypoint zoom" href="#" ><img src="/images/btn-clear-field-amber.svg" alt="Remove waypoint" /></a>';
			newInputHtml += removeWaypointButtonHtml;
			
			// Add a add waypoint button
			const addWaypointButtonHtml = '<a class="addWaypoint zoom" href="#" title="Add waypoint"><img src="/images/icon-add-waypoint.svg" alt="Add waypoint" /></a>';
			newInputHtml += addWaypointButtonHtml;
			
			// Add a reorder handle	
			const reorderWaypointHtml = '<a class="reorderWaypoint zoom" href="#" title="Reorder waypoint"><img src="/images/icon-reorder.svg" /></a>';
			newInputHtml += reorderWaypointHtml;
			
			// Wrap this in a inputDiv div
			const divHtml = '<div class="inputDiv">' + newInputHtml + '</div>';
			
			return divHtml;
		},
		
		
		// Function to remove a geocoder input
		removeWaypointGeocoder: function (waypointElement)
		{
			// Get the container of this input (img> a.removeWaypoint > div.inputDiv)
			const divContainer = $(waypointElement).parent().parent();
			
			// Get the waypoint name from the input
			const inputElementName = $(waypointElement).parent().siblings('input').first().attr('name');
			
			// Only delete the actual input if we have > 2 inputs left
			if ($('.inputDiv').length > 2) {
				$(divContainer).remove();
			} else {
				// Delete any waypoint text in the input
				$(waypointElement).parent().siblings('input').first().val ('');
			}
			
			// If this geocoder has a contributed to a waypoint, find it
			const waypointIndex = _waypoints.findIndex ((wp) => wp.label == inputElementName);
			const waypoint = _waypoints[waypointIndex];
			
			// Remove any markers with the lngLat of the _waypoint
			if (waypointIndex > -1) {
				const markerIndex = _markers.findIndex((marker) => marker._lngLat.lng == waypoint.lng && marker._lngLat.lat == waypoint.lat);
				if (markerIndex > -1) {
					_markers[markerIndex].remove();
				}
			}
			
			// Remove the waypoint from waypoints array
			_waypoints.splice(waypointIndex, 1);
			
			// Enable or disale route planning button
			routing.enableOrDisableRoutePlanningButton ();
			
			// Rescan and fix colour
			routing.sortWaypoints ();
			
			// Resize map element
			// #!# Global object not supplied - should use a handle instead
			cyclestreetsui.fitMap ();
		},
		
		
		// Function to create a route planning UI
		createRoutePlanningControls: function (createHtml)
		{
			// Ensure the plannerDivPath is a simple div ID; at present other structures are not supported
			let matches = _settings.plannerDivPath.match (/^#([A-Za-z][-_A-Za-z0-9]*)$/);
			if (!matches) {
				console.log ('ERROR: createRoutePlanningControls has been enabled, but the specified plannerDivPath (' + _settings.plannerDivPath + ') is not a simple ID, which is currently all that is supported.');
			}
			_plannerDivId = matches[1];
			
			// Ditto resultsContainerDivPath
			matches = _settings.resultsContainerDivPath.match (/^#([A-Za-z][-_A-Za-z0-9]*)$/);
			if (!matches) {
				console.log ('ERROR: createRoutePlanningControls has been enabled, but the specified resultsContainerDivPath (' + _settings.resultsContainerDivPath + ') is not a simple ID, which is currently all that is supported.');
			}
			const resultsContainerDivId = matches[1];
			
			// Attach the route planning UI either to the Card UI (for mobile) or to the bottom-right of the map (for desktop)
			if (_isMobileDevice) {
				$('#cardcontent').append ('<div id="' + _plannerDivId + '"></div>');
			} else {
				routing.createControl (_plannerDivId, 'bottom-right');
			}
			
			// Add title
			const html = '<h2>Route planner</h2>';
			$('#' + _plannerDivId).append (html);
			
			// Add or assign input widgets
			const totalWaypoints = 2;
			let waypointName;
			let label;
			let waypointNumber;
			let input;
			for (waypointNumber = 0; waypointNumber < totalWaypoints; waypointNumber++) {
				
				// Set the label
				switch (waypointNumber) {
					case 0: label = 'Start'; break;
					case (totalWaypoints - 1): label = 'Finish'; break;
					default: label = 'Waypoint';
				}
				
				// Create the input widget
				waypointName = 'waypoint' + waypointNumber;
				input = '<p><input name="' + waypointName + '" type="search" placeholder="' + label + '" class="geocoder" /></p>';
				$('#' + _plannerDivId).append (input);
			}
			
			// Add Submit button
			// #!# Should be a proper submit button
			const submitButton = '<p><a id="getRoutes" href="#" title="Plan route">Plan route</a></p>';
			$('#' + _plannerDivId).append (submitButton);
			
			// Put focus on the first available geocoder
			if (!_isMobileDevice) {
				routing.focusFirstAvailableGeocoder (totalWaypoints);
			}
			
			// Add results div
			$('#' + _plannerDivId).append ('<div id="' + resultsContainerDivId + '"></div>');
		},
		
		
		// Helper function to put focus in the first available geocoder control
		focusFirstAvailableGeocoder: function (totalWaypoints)
		{
			// Loop through each available slot
			let waypointName;
			let element;
			let waypointNumber;
			for (waypointNumber = 0; waypointNumber < totalWaypoints; waypointNumber++) {
				
				// Check if this geocoder input exists
				waypointName = 'waypoint' + waypointNumber;
				element = '#' + _plannerDivId + ' input[name="' + waypointName + '"]';
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
			const waypointName = 'waypoint' + (waypointNumber);
			const element = _settings.plannerDivPath + ' input[name="' + waypointName + '"]';
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
				//routing.routing ();
			});
			
			// Listen for clicks in the style changer
			// !FIXME this is very hacky
			$(_settings.mapStyleDivPath + ' ul li').on ('click', function () {
				if (_showPlannedRoute) {
					setTimeout (() => {
						location.reload ();
					}, 100);
				}
			});
		},
		
		
		// Add a pin to the map center, used only at start when clicking to open the map card to initialise JP
		addMapCenter: function ()
		{
			const center = _map.getCenter();
			
			// Register the waypoint
			// This overwrites any existing waypoints
			const waypoint = {lng: center.lng, lat: center.lat, label: 'waypoint0'};
			
			// Add the waypoint marker
			routing.addWaypointMarker (waypoint);

		},
		
		
		// Setter function to enable or disable map click behaviour
		// Accepts a boolean: true will disable map click listening, false will enable it
		disableMapClickListening: function (disabled)
		{
			_disableMapClicks = disabled;
		},
		
		
		// Function to add the routing
		routing: function ()
		{
			// If the route is already loaded, show it
			if (!$.isEmptyObject (_routeGeojson)) {
				// Clear any existing route
				const retainWaypoints = true;
				const keepMarkers = true;
				routing.removeRoute (retainWaypoints, keepMarkers);
				
				// Add the route for each strategy, and end
				$.each (_settings.strategies, function (index, strategy) {
					routing.showRoute (_routeGeojson[strategy.id], strategy);
				});
				
				// Add results tabs
				routing.resultsTabs ();
				
				return;
			}
			
			// Handler for clicking on the map and adding a waypoint
			_map.on ('click', function (e) {
				
				// Take no action if class variable is set to ignore map clicks
				if (_disableMapClicks) {return;}
				
				// Take no action if we clicked on a marker
				if ($(e.originalEvent.target).hasClass ('marker')) {return;}
				
				// Take no action on the click handler if a route is loaded
				if (!$.isEmptyObject (_routeGeojson)) {return;}
				
				// Ensure sufficiently zoomed in
				const currentZoom = Math.round(_map.getZoom () * 10) / 10;	// Round to 1dp; flyTo can end up with rounding errors, e.g. 13 goes to 12.9999931 or 13.0000042
				if (currentZoom < _settings.minimumZoomForStreetSelection) {
					const newZoom = Math.min((currentZoom + 3), _settings.minimumZoomForStreetSelection);
					_map.flyTo ({center: [e.lngLat.lng, e.lngLat.lat], zoom: newZoom});
					return;
				}
				
				// Build the waypoint
				const waypoint = {lng: e.lngLat.lng, lat: e.lngLat.lat, label: null /* i.e., autodetermine label */};
				
				// If we are in singleMarkerMode, i.e., setting a home/work location, redirect to the function
				if (_singleMarkerMode) {
					// #!# Global object not supplied - should use a handle instead
					const locationName = cyclestreetsui.getSettingLocationName (); // i.e., 'home', 'work'
					routing.setFrequentLocation (waypoint, locationName);
					return;
				}
				
				// Add the waypoint marker
				// This will fill the first empty inputs, then if none are empty, add an input
				const addInput = true;
				routing.addWaypointMarker (waypoint, addInput);
				
				// Load the route if it is plannable, i.e. once there are two waypoints
				// Loading route on map click is a setting and can be disabled
				if (_settings.planRoutingOnMapClick) {
					routing.plannable ();
				}
			});
		},
		
		
		// Drop marker at user's geolocation
		setMarkerAtUserLocation: function ()
		{
			// We can not do this if user geolocation isn't available
			// #!# Global object not supplied - should use a handle instead
			if (!layerviewer.getGeolocationAvailability ()) {return;}
			
			// Immediately set the value of the input box to mark it as occupied
			// This is so any other markers dropped in quick sucession will know that this box is going to be filled, once the AJAX call completes, and will use the succeeding empty inputs
			$(_settings.plannerDivPath + ' input.locationTracking').first ().val ('Finding your location…');
			
			// Retrieve the geolocation from layerviewer
			// #!# Global object not supplied - should use a handle instead
			const geolocation = layerviewer.getGeolocation ();
			const geolocationLngLat = geolocation._accuracyCircleMarker._lngLat;
			
			// Build the waypoint to be "dropped" into map
			const waypoint = {lng: geolocationLngLat.lng, lat: geolocationLngLat.lat, label: 'waypoint0'};
			routing.addWaypointMarker (waypoint);
			
			/*
			// #!# Global object not supplied - should use a handle instead
			const geolocation = layerviewer.checkForGeolocationStatus (function (position) {
				// Build the waypoint to be "dropped" into map
				const waypoint = {lng: position.coords.longitude, lat: position.coords.latitude, label: 'waypoint0'};
				routing.addWaypointMarker (waypoint);
			});
			*/
		},
		
		
		// Setter for _singleWaypointMode, accessed externally
		setSingleMarkerMode: function (isEnabled)
		{
			_singleMarkerMode = isEnabled;
			
			if (isEnabled) {
				// Disable all drag events on current markers (if any journey is being planned)
				$.each (_markers, function (indexInArray, marker) {
					marker.setDraggable(false);
					
					// Set the marker as grayscale
					const markerElement = marker.getElement ();
					$(markerElement).addClass ('grayscale');
				});
			} else {
				$.each (_markers, function (indexInArray, marker) {
					// Enable all drag events on current markers
					marker.setDraggable(true);
					
					// Delete any markers that are not part of the JP waypoints
					if (!marker.hasOwnProperty('waypointNumber')) {marker.remove ();}
					
					// Remove grayscale effect
					const markerElement = marker.getElement ();
					$(markerElement).removeClass ('grayscale');
				});
			}
			
			return _singleMarkerMode;
		},
		
		
		// Getter for single marker mode
		getSingleMarkerMode: function ()
		{
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
			
			// Turn on route display mode
			routing.plannedRouteShouldBeShown (true);
			
			// Convert waypoints to strings
			const waypointStrings = routing.waypointStrings (_waypoints, 'lng,lat');
			
			// Add results tabs
			routing.resultsTabs ();
			
			// Construct the URL and load
			let url;
			let constructUrlFromStrategyFunction;
			if (_settings.multiplexedStrategies) {
				
				// Assemble the composite url for all plans
				let plans = [];
				$.each (_settings.strategies, function (indexInArray, strategy) {
					// Combine plans (N.B. combining other parameters is not supported as this time)
					plans.push (strategy.parameters.plans);
				});
				plans = plans.join (',');
				constructUrlFromStrategyFunction = 'constructUrlFromStrategy_' + _settings.strategies[0].implementation;
				url = routing[constructUrlFromStrategyFunction] (_settings.strategies[0].baseUrl, {plans: plans}, waypointStrings);
				
				routing.loadRoute (url, _settings.strategies[0], function (strategy_ignored, multiplexedResult) {
					// De-multiplex route
					const routes = routing.demultiplexRoute (multiplexedResult);
					
					// Process each route individually
					$.each (routes, function (index, routeInfo) { 						
						// Emulate /properties/plans present in the multipart route
						// #!# Vestigial structure left over from the single-route v1 API class structure
						const route = routing.emulatePropertiesPlans (routeInfo.routeGeoJson, routeInfo.id);
						routing.processRoute (routeInfo.strategyObject, route);
					});
				});
				
			} else {
				
				// Load routes from URL collection
				$.each (_settings.strategies, function (index, strategy) {
					constructUrlFromStrategyFunction = 'constructUrlFromStrategy_' + strategy.implementation;
					url = routing[constructUrlFromStrategyFunction] (strategy.baseUrl, strategy.parameters, waypointStrings);
					routing.loadRoute (url, strategy, routing.processRoute);
				});
			}
		},
		
		
		// Construct URL from strategy
		constructUrlFromStrategy_cyclestreets: function (baseUrl_ignored, parameters, waypointStrings)
		{
			// Start with the strategy-specific parameters in the strategy definitions above
			parameters = $.extend (true, {}, parameters);	// i.e. clone
			
			// Add additional parameters
			parameters.key = _settings.apiKey;
			parameters.waypoints = waypointStrings.join ('|');
			parameters.speedKmph = _speedKmph;
			parameters.archive = 'full';
			parameters.itineraryFields = 'id,start,finish,waypointCount';
			parameters.journeyFields = 'path,plan,lengthMetres,timeSeconds,grammesCO2saved,kiloCaloriesBurned,elevationProfile';
			
			// Assemble URL
			const url = _settings.apiBaseUrl + '/v2/journey.plan' + '?' + $.param (parameters, false);	
			
			// Return the URL
			return url;
		},
		
		
		// Construct URL from strategy
		constructUrlFromStrategy_osrm: function (baseUrl, parameters, waypointStrings)
		{
			// Start with the strategy-specific parameters in the strategy definitions above
			parameters = $.extend (true, {}, parameters);	// i.e. clone
			
			// Add additional parameters
			parameters.alternatives = 'false';
			parameters.overview = 'full';
			parameters.steps = 'true';
			parameters.geometries = 'geojson';
			const waypoints = waypointStrings.join (';');
			
			// Construct the URL
			const url = baseUrl + '/' + waypoints + '?' + $.param (parameters, false);
			
			// Return the result
			return url;
		},
		
		
		// Function to demultiplex a CycleStreets API v2 route
		demultiplexRoute: function (multiplexedResult)
		{
			// Split the multiplexedResult.features into 3 parts, keeping the properties the same for each one
			
			// Find the planIndex to start off each route
			const strategies = [];
			$.each(_settings.strategies, function (indexInArray, strategy) {
				strategies.push ({
						id: strategy.parameters.plans,
						planIndex: routing.findPlanIndex (multiplexedResult, strategy.parameters.plans)
					}
				);
			});
			
			// Copy the relevant parts to a new array
			$.each(strategies, function (indexInArray, strategyInfo) {
				
				// Get the waypoint features (same for each strategy)
				const waypointFeatures = multiplexedResult.features.slice(0, strategies[0].planIndex); // i.e., the start of the first plan index
				
				// Get the index where this feature ends, by scrying the start of the following strategy features, or if this is the last strategy, slicing to the end of the array
				const indexEndOfFeature = (indexInArray == (strategies.length - 1) ? multiplexedResult.features.length : strategies[indexInArray + 1].planIndex);
				
				// Slice features to the results that we want
				const journeyPlanFeatures = multiplexedResult.features.slice(strategyInfo.planIndex, indexEndOfFeature);
				
				// Add the two arrays together
				const combinedFeatures = waypointFeatures.concat(journeyPlanFeatures);
				
				// Append this to the strategies array
				const routeGeoJson = {
					type: multiplexedResult.type, // i.e., same for all strategies
					properties: multiplexedResult.properties, // i.e., same for all strategies
					features: combinedFeatures // different for each strategy
				};
				strategies[indexInArray].routeGeoJson = routeGeoJson;
				
				// Append the relevant _settings strategy object, as this is used by processRoute and showRoute functions
				// #!# This is a vestigial remnant of the v1 single route class structure and should be refactored.
				// Find the strategy that matches the current route
				$.each (_settings.strategies, function (indexInArray, strategy) {
					if (strategy.id == strategyInfo.id) {
						strategies[indexInArray].strategyObject = strategy;
						return;
					}
				});
			});
			
			return strategies;
		},
		
		
		// Function to process a route, i.e., adding GeoJSON, showing the route, and updatin gthe itinerary number in the URL
		processRoute: function (strategy, result)
		{
			// Register the GeoJSON to enable the state to persist between map layer changes and to set that the route is loaded
			_routeGeojson[strategy.id] = result;
			
			routing.showRoute (_routeGeojson[strategy.id], strategy);
			
			// Set the itinerary number permalink in the URL
			const itineraryId = _routeGeojson[strategy.id].properties.id;
			routing.updateUrl (itineraryId, _waypoints);
			
			// Fit bounds
			routing.fitBoundsGeojson (_routeGeojson[strategy.id], strategy.id);
		},
		
		
		// Function to convert waypoints to strings
		waypointStrings: function (waypoints, order)
		{
			const waypointStrings = [];
			$.each (waypoints, function (index, waypoint) {
				let waypointString;
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
			// #!# Needs to be re-enabled but currently this will also remove the whole panel
			//const clearRouteHtml = '<p><a id="clearroute" href="#">Clear route &hellip;</a></p>';
			
			// Create tabs and content panes for each of the strategies
			let tabsHtml = '<ul id="strategies">';
			let contentPanesHtml = '<div id="itineraries">';
			$.each (_settings.strategies, function (index, strategy) {
				const rgb = routing.hexToRgb (strategy.lineColour);
				tabsHtml += '<li><a data-strategy="' + strategy.id + '" href="#' + strategy.id + '" style="background-color: rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + '0.3' + ');"><label>' + routing.htmlspecialchars (strategy.label).replace('route', '') + '</label></a></li>';
				contentPanesHtml += '<div id="' + strategy.id + '"><span class="loader" style="border-bottom-color:#e54124;"></span></div>';
			});
			tabsHtml += '</ul>';
			contentPanesHtml += '</div>';
			
			// Assemble the HTML
			//let html = clearRouteHtml + tabsHtml + contentPanesHtml;
			let html = tabsHtml + contentPanesHtml;
			
			// Surround with a div for styling
			html = '<div id="results">' + html + '</div>';
			
			// Append the panel to the route planning UI; this will contain #results (created above, plus switching behaviour added to below)
			$(_settings.resultsContainerDivPath).append (html);
			
			// Add jQuery UI tabs behaviour
			$('#results').tabs ();
			
			// Ensure scroll to top of panel on tab change
			$('#results').on ('tabsactivate', function (event, ui) {
				ui.newPanel[0].scrollIntoView ();
			});
			
			// Select the default tab
			$('#results').tabs ('option', 'active', _routeIndexes[_selectedStrategy]);
			
			// On switching tabs, change the line thickness; see: https://stackoverflow.com/a/43165165/180733
			$('#results').on ('tabsactivate', function (event, ui) {
				const newStrategyId = ui.newTab.attr ('li', 'innerHTML')[0].getElementsByTagName ('a')[0].dataset.strategy;	// https://stackoverflow.com/a/21114766/180733
				_map.setPaintProperty (newStrategyId, 'line-width', _settings.lineThickness.selected);
				if (_settings.lineOutlines) {
					_map.setPaintProperty (newStrategyId + '-outline', 'line-width', _settings.lineThickness.selectedOutline);
				}
				routing.setSelectedStrategy (newStrategyId);
				const oldStrategyId = ui.oldTab.attr ('li', 'innerHTML')[0].getElementsByTagName ('a')[0].dataset.strategy;
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
			let hex = routing.colourNameToHex (colour);
			
			// Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
			const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
			hex = hex.replace (shorthandRegex, function (m, r, g, b) {
				return r + r + g + g + b + b;
			});
			
			// Assemble the result
			const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
			return (result ? {
				r: parseInt (result[1], 16),
				g: parseInt (result[2], 16),
				b: parseInt (result[3], 16)
			} : null);
		},
		
		
		// Function to convert HTML colour names to Hex; see: https://stackoverflow.com/a/1573141/180733
		colourNameToHex: function (colour)
		{
			const colours = {
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
			let html = '';
			
			// Add the journey stats, like distance, calories, etc
			const timeFormatted = routing.formatDuration (geojson.properties.plans[strategy.id].time);
			const distanceFormatted = routing.formatDistance (geojson.properties.plans[strategy.id].length);
			
			html += '<p class="location">' + (geojson.properties.start || '[Unknown name]') + ' to ' + (geojson.properties.finish || '[Unknown name]') + '</p>';
			
			html += '<ul class="journeyStats">';
			html += '<li><img src="' + _settings.images.distance + '" alt="Distance" /><p> ' + distanceFormatted + '</p>';
			html += '<li><img src="' + _settings.images.time     + '" alt="Time" /><p> ' + timeFormatted + '</p></li>';
			if (geojson.properties.plans[strategy.id].kiloCaloriesBurned !== null) {
				html += '<li><img src="' + _settings.images.calories + '" alt="Calories" /><p> ' + geojson.properties.plans[strategy.id].kiloCaloriesBurned + ' calories</p></li>';
			}
			if (geojson.properties.plans[strategy.id].grammesCO2saved !== null) {
				html += '<li><img src="' + _settings.images.co2      + '" alt="CO2 saving" /><p> ' + geojson.properties.plans[strategy.id].grammesCO2saved + ' g</p></li>';
			}
			if (_settings.strategies[ _routeIndexes[strategy.id] ].gpx) {
				// #!# Currently hard-coded to specific service
				const journeyId = geojson.properties.id;
				const gpxLink = 'https://www.cyclestreets.net/journey/' + journeyId + '/cyclestreets' + journeyId + strategy.id + '.gpx';
				html += '<li><img src="' + _settings.images.gpx      + '" alt="GPX link" width="12" height="12" /><p><a href="' + gpxLink + '">GPX</a></p></li>';
			}
			html += '</ul>';
			
			// Add elevation chart if required
			// #!# Need to change to be not generated if no data, but data is compiled after this point
			html += '<div class="elevation-chart-container"><canvas id="' + strategy.id + 'elevationChart"></canvas></div>';
			html += '<span class="elevation"></span>';
			html += '<a href="#" class="elevation-scrubber"><img src="/images/elevation-dragger.svg" alt="Dragger icon" /></a>';
			
			// Loop through each feature to create the table; if setting non-default travelleable hours per day, split by day
			const segmentsIndex = {};
			let segment = 0;
			let cumulativeSeconds = 0;
			let dayNumber = 1;
			const daysJumplist = [];
			let tableHtml = '';
			const tableStart = '<table class="itinerary lines strategy-' + strategy.id + '">';
			if (_settings.travellableHoursPerDay != 24) {
				if ((geojson.properties.plans[strategy.id].time / (60*60)) > _settings.travellableHoursPerDay) {
					tableHtml += '<p id="' + strategy.id + '-day' + dayNumber + '" class="daynumber">Day ' + dayNumber + ':</p>';
					daysJumplist.push ('<a href="#' + strategy.id + '-day' + dayNumber + '">' + dayNumber + '</a>');
				}
			}
			tableHtml += tableStart;
			const lastIndex = geojson.features.length - 1;
			$.each (geojson.features, function (index, feature) {
				
				// Skip non-streets
				if (!feature.properties.path.match (/street/)) {return 'continue';}
				
				// Register this row in the segment index, starting from 1
				segment++;
				segmentsIndex[segment] = index;
				
				// Add this row
				tableHtml += '<tr data-segment="' + segment + '">';
				tableHtml += '<td class="travelmode">' + routing.travelModeIcon (feature.properties.travelMode, strategy.id) + '</td>';
				tableHtml += '<td>' + routing.turnsIcon (feature.properties.startBearing) + '</td>';
				tableHtml += '<td><strong>' + routing.htmlspecialchars (feature.properties.name) + '</strong></td>';
				tableHtml += '<td>' + feature.properties.ridingSurface + '</td>';
				tableHtml += '<td>' + routing.formatDistance (feature.properties.lengthMetres) + '</td>';
				tableHtml += '<td>' + routing.formatDuration (feature.properties.timeSeconds) + '</td>';
				tableHtml += '</tr>';
				
				// Increment the seconds counter
				cumulativeSeconds += feature.properties.timeSeconds;
				
				// Break the table if setting travelleable hours per day
				if (_settings.travellableHoursPerDay != 24) {
					if (((cumulativeSeconds / (60*60)) > _settings.travellableHoursPerDay) && (index != lastIndex)) {
						tableHtml += '</table>';
						dayNumber++;
						cumulativeSeconds = 0;	// Reset to new day's seconds
						tableHtml += '<p id="' + strategy.id + '-day' + dayNumber + '" class="daynumber">Day ' + dayNumber + ':</p>';
						daysJumplist.push ('<a href="#' + strategy.id + '-day' + dayNumber + '">' + dayNumber + '</a>');
						tableHtml += tableStart;
					}
				}
			});
			tableHtml += '</table>';
			
			// Add the day jumplist if required
			if (daysJumplist.length) {
				html += '<p id="jumptoday">Jump to day: ' + daysJumplist.join (' ') + '</p>';
			}
			
			// Add the table HTML
			html += tableHtml;
			
			// Save the last segment number
			const lastSegment = segment;
			
			// Set the content in the tab pane, overwriting any previous content
			$('#itineraries #' + strategy.id).html (html);
			
			// Add a tooltip to the tab, giving the main route details
			const title = strategy.label + ':\nDistance: ' + distanceFormatted + '\nTime: ' + timeFormatted;
			$('#strategies li a[data-strategy="' + strategy.id + '"]').attr ('title', title);
			
			// If a table row is clicked on, zoom to that section of the route (for that strategy)
			$('#itineraries table.strategy-' + strategy.id).on('click', 'tr', function (e) {
				const zoomToSegment = segmentsIndex[e.currentTarget.dataset.segment];
				routing.zoomToSegment (geojson, zoomToSegment);
				_keyboardFeaturePosition[strategy.id] = zoomToSegment;
			});
			
			// Make elevation scrubber draggable
			routing.elevationScrubber (geojson);
			
			// Generate elevation graph, if enabled
			routing.generateElevationGraph (strategy.id, geojson);
			
			// Handle left/right keyboard navigation through the route, for this strategy
			routing.itineraryKeyboardNavigation (strategy.id, geojson, segmentsIndex, lastSegment);
		},
		
		
		// Function to initialise the elevation scrubber and to provide handlers for it
		elevationScrubber: function (geojson)
		{
			// Drag event handler
			$('.elevation-scrubber').draggable ({
				axis: 'x',
				containment: 'parent',
				drag: routing.throttle (function (event) {
					
					// Which chart are we dragging on, i.e., quietest, balanced
					const chartStrategyName = $(event.target).siblings ('div').children ('canvas').attr ('id').replace ('elevationChart', '');
					
					// Get the approximate index in that chart
					const xAxisPercentage = (100 * parseFloat ($(this).position().left / parseFloat ($(this).parent().width())) );
					
					// Find what percentage of the total journey distance we are at
					const planIndex = routing.findPlanIndex (_elevationChartArray[chartStrategyName].geojson, chartStrategyName);
					const totalJourneyDistanceMetres = _elevationChartArray[chartStrategyName].geojson.features[planIndex].properties.lengthMetres;
					const approximateJourneyDistanceMetres = totalJourneyDistanceMetres * xAxisPercentage / 100;
					
					// Loop through the features until we find we a coordinate object with cumulativeMetres > approximateJourneyDistanceMetres
					let coordinateObject = null;
					$.each (_elevationChartArray[chartStrategyName].dataArray, function (indexInArray, coordinates) {
						if (coordinates.x > approximateJourneyDistanceMetres) {
							coordinateObject = coordinates;
							return false; // i.e. break out of the loop
						}
					});
					
					// Update the elevation label
					$('span.elevation').show ().text (coordinateObject.y + 'm elevation');
					
					// Jump to segment
					_map.flyTo ({
						zoom: _settings.maxZoomToSegment,
						center: [coordinateObject.coordinates[0], coordinateObject.coordinates[1]],
						animate: true,
						essential: true,
						duration: 500
					});
					
					// Add a cycle marker to the map to show where we are currently scrolling
					const cycleMarkerIndex = _markers.findIndex ((marker) => marker.__satnavMarker == true);
					if (cycleMarkerIndex > -1) {
						
						// We already have a cyclist marker, update the location
						_markers[cycleMarkerIndex].setLngLat([coordinateObject.coordinates[0], coordinateObject.coordinates[1]]);
					} else {
						
						// Place a cycle marker at this location
						const cyclistMarker = document.createElement('div');
						cyclistMarker.className = 'itinerarymarker cyclistmarker';
						cyclistMarker.style.backgroundImage = "url('" + '/images/sat-nav-positional-marker.svg' + "')";
						
						// Add the marker
						const marker = new mapboxgl.Marker({element: cyclistMarker, offset: [0, 0], draggable: false})	// See: https://www.mapbox.com/mapbox-gl-js/api/#marker
							.setLngLat({lng: coordinateObject.coordinates[0], lat: coordinateObject.coordinates[1]})
							.setPopup( new mapboxgl.Popup({offset: 25}).setHTML('Your position') )
							.addTo(_map);
						
						// Unofficially overload the Marker with a waypoint number property, to tie this marker to a waypoint input
						marker.__satnavMarker = true;
						
						// Register the marker
						_markers.push (marker);
					}
					
				}, 200),	// Throttling delay
				
				// Set the elevation label to a debounce function to disappear after a timeout
				stop: routing.debounce (function() {
					$('span.elevation').fadeToggle (500);
				}, 2000)
			});
		},
		
	
		// Debounce function
		debounce: function (func, wait, immediate)
		{
			let timeout;
			
			return function executedFunction() {
				let context = this;
				const args = arguments;
				
				const later = function () {
					timeout = null;
					if (!immediate) {
						func.apply (context, args);
					}
				};
				
				const callNow = immediate && !timeout;
				
				clearTimeout (timeout);
				
				timeout = setTimeout (later, wait);
				
				if (callNow) {
					func.apply (context, args);
				}
			};
		},
		
		
		// Throttler function
		throttle: function (func, limit)
		{
			let lastFunc;
			let lastRan;
			return function () {
				const context = this;
				const args = arguments;
				if (!lastRan) {
					func.apply (context, args);
					lastRan = Date.now ();
				} else {
					clearTimeout(lastFunc);
					lastFunc = setTimeout (function () {
						if ((Date.now () - lastRan) >= limit) {
							func.apply (context, args);
							lastRan = Date.now ();
						}
					}, limit - (Date.now () - lastRan));
				}
			};
		},
		
		
		// Function to generate an elevation array, used by the elevation graph
		generateElevationArray: function (strategyId, geojson)
		{
			// Build an alternative data array with [cumulativeMetres, elevationMetres, coordinates, journeySegments]
			// Although the first three variables are available in the route overview (object 2 in geojson), journeySegments have to be extracted individually
			const dataArray = [];
			
			// Start at the first feature after the plan index
			const planIndex = routing.findPlanIndex (geojson, strategyId);
			let featureIndex = planIndex + 1; // Start iterator
			const featuresLength = geojson.features.length;
			
			// Initialise counters and iterators we will use
			let overallCoordinateIndex = 0; // Track the total amount of coordinates
			let featureCoordinateIndex = 0; // Track which coordinate we are in in each feature, reset after iterating through each feature
			let coordinatesLength = 0; // Track how many coordinates are in each feature, reset after iterating through each feature
			let lastDesiredCoordinateIndex = 0; // Used to ignore the last coordinate of journey segments
			let coordinateDataObject = {}; // Used to store data in [cumulativeMetres, elevationMetres, coordinates, journeySegments] format
			
			// Loop through all the features, and build a geometry array
			for (featureIndex; featureIndex < featuresLength; featureIndex++) {
				
				// Reset feature coordinate
				featureCoordinateIndex = 0;
				
				// Calculate how many coordinates are in this feature
				coordinatesLength = geojson.features[featureIndex].geometry.coordinates.length;
				
				// Get all but the last coordinate, except in the last feature, as these are duplicated to connect segments (e.g. [1,2,3], [3,4,5], [5,6,7])
				if (featureIndex == (featuresLength - 1)) { // i.e. the last feature, whose last coordinate we want
					lastDesiredCoordinateIndex = coordinatesLength - 1;
				} else { // i.e. any other previous feature, whose last coordinate we don't want
					lastDesiredCoordinateIndex = coordinatesLength - 2;
				}
				
				// Loop through the coordinates, and associate each one with a cumulativeMetres, elevationMetres, and journeySegment
				for (featureCoordinateIndex; featureCoordinateIndex <= lastDesiredCoordinateIndex; featureCoordinateIndex++) {
					
					// Build this coordinate's object
					coordinateDataObject = {
						'coordinates': geojson.features[featureIndex].geometry.coordinates[featureCoordinateIndex],
						'x': geojson.features[planIndex].properties.elevationProfile.cumulativeMetres[overallCoordinateIndex],
						'y': geojson.features[planIndex].properties.elevationProfile.elevationsMetres[overallCoordinateIndex],
						'journeySegment': featureIndex
					};
					
					// Push it to the array
					dataArray.push(coordinateDataObject);
					
					// Iterate counters
					overallCoordinateIndex++;
				}
			}
			
			// Store the data as a class variable, and return it
			_elevationChartArray[strategyId] = {'geojson': geojson, 'dataArray': dataArray};
			return _elevationChartArray[strategyId];
		},
		
		
		// Function to write an elevation graph, used when generating the itinerary listing
		generateElevationGraph: function (strategyId, geojson)
		{
			// Obtain the element to load the chart into, or end
			const canvas = document.getElementById (strategyId + 'elevationChart');
			if (!canvas) {return;}
			
			// Generate the elevation array
			const graphData = routing.generateElevationArray (strategyId, geojson);
			
			// Search geojson.features array for an object containing properties: {path: plan/{strategyId}}
			const planIndex = routing.findPlanIndex (geojson, strategyId);
			
			// Display the elevation graph
			const ctx = canvas.getContext ('2d');		
			_elevationCharts[strategyId] = new Chart(ctx, {
				type: 'scatter',
				data: {
					datasets: [{
						label: 'Elevation',
						data: graphData.dataArray,
						showLine: true,
						backgroundColor: 'rgba(220,79,85,1)',
						pointRadius: 0
					}]
				},
				options: {
					tooltips: {
						enabled: false
					},
					legend: {
						display: false
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
								display: false,
								beginAtZero: false,
								min: geojson.features[planIndex].properties.elevationProfile.min,
								max: geojson.features[planIndex].properties.elevationProfile.max
							}
						}]
					},
					responsive: true,
					maintainAspectRatio: false,
					layout: {
						padding: {
							left: -10,
							right: 0,
							top: 0,
							bottom: -10
						}
					}
				}
			});
			/*
				options: {
					// On click, find the respective journey segment and zoom to that
					onClick: function (evt) {
						const activePoints = _elevationCharts[strategyId].getElementsAtXAxis(evt);
						const chartIndex = activePoints[0]._index;
						const journeySegment = activePoints[0]._xScale.ticks[chartIndex];
						
						// Jump to segment
						routing.zoomToSegment(geojson, journeySegment);
					},
			*/
		},
		
		
		// Function to zoom to a specified feature
		zoomToSegment: function (geojson, segment)
		{
			const boundingBox = routing.getBoundingBox (geojson.features[segment].geometry.coordinates);
			_map.fitBounds (boundingBox, {maxZoom: _settings.maxZoomToSegment, animate: true, essential: true, duration: 500});	// Bounding box version of flyTo
		},
		
		
		// Function to determine the bounding box for a feature; see: https://stackoverflow.com/a/35685551/180733
		getBoundingBox: function (coordinates)
		{
			// Loop through the coordinates
			const bounds = {};
			let latitude;
			let longitude;
			let j;
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
						const key = event.which;
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
			const icons = {
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
			const turns = {
				'0':	'continue',
				'45':	'bear-right',
				'90':	'turn-right',
				'135':	'sharp-right',
				'180':	'u-turn',
				'235':	'sharp-left',
				'290':	'turn-left',
				'335':	'bear-left',
				'360':	'continue'
			};
			
			// Find the closest; see: https://stackoverflow.com/a/19277804/180733
			const bearings = Object.keys (turns);
			const closest = bearings.reduce (function (prev, curr) {
				return (Math.abs (curr - bearing) < Math.abs (prev - bearing) ? curr : prev);
			});
			
			// Set the icon
			const icon = turns[closest];
			
			// Assemble and return the HTML
			return '<span class="turnsicons turnsicon-' + icon + '"></span>';
		},
		
		
		// Setter for distance unit
		// Accepts 'miles' or 'kilometers'
		setDistanceUnit: function (unitAsString)
		{
			_settings.distanceUnit = unitAsString;
		},
		
		
		// Setter for cycling speed
		// Accepts '16', '20' or '24', as per the API
		setCyclingSpeed: function (unitAsString)
		{
			_speedKmph = unitAsString;
		},
		
		
		// Function to format a distance
		formatDistance: function (metres)
		{
			let result;
			if (_settings.distanceUnit == 'kilometers') {
				
				// Convert to km
				if (metres >= 1000) {
					const km = metres / 1000;
					result = Number (km.toFixed(1)) + 'km';
					return result;
				}
				
				// Round metres
				result = Number (metres.toFixed ()) + 'm';
				return result;
			} else if (_settings.distanceUnit == 'miles') {
				const miles = metres / 1000 / 1.6;
				result = Number (miles.toFixed(1)) + ' miles';
				return result;
			}
		},
		
		
		// Function to format a duration
		formatDuration: function (seconds)
		{
			// Calculate values; see: https://stackoverflow.com/a/16057667/180733
			const travellableSecondsPerDay = (60 * 60 * _settings.travellableHoursPerDay);
			const days = Math.floor (seconds / travellableSecondsPerDay);
			const hours = Math.floor (((seconds / travellableSecondsPerDay) % 1) * _settings.travellableHoursPerDay);
			const minutes = Math.floor (((seconds / 3600) % 1) * 60);
			seconds = Math.round (((seconds / 60) % 1) * 60);
			
			// Assemble the components
			const components = [];
			if (days) {components.push (days + ' ' + (_settings.travellableHoursPerDay == 24 ? '' : _settings.travellableHoursPerDay + '-hour ') + (days == 1 ? 'day' : 'days'));}
			if (hours) {components.push (hours + 'h');}
			if (minutes) {components.push (minutes + 'm');}
			if (!components.length) {
				components.push (seconds + 's');
			}
			
			// Assemble the string
			const result = components.join (', ');
			
			// Return the result
			return result;
		},
		
		
		// Function to load a route from a specified itinerary ID
		loadRouteFromId: function (itineraryId)
		{
			// Turn on route display mode
			routing.plannedRouteShouldBeShown (true);
			
			// Load the route for each strategy
			$.each (_settings.strategies, function (index, strategy) {
				
				// Construct the route request
				const parameters = $.extend (true, {}, strategy.parameters);	// i.e. clone
				parameters.key = _settings.apiKey;
				parameters.id = itineraryId;
				parameters.itineraryFields = 'id,start,finish,waypointCount';
				parameters.journeyFields = 'path,plan,lengthMetres,timeSeconds,grammesCO2saved,kiloCaloriesBurned,elevationProfile';
				const url = _settings.apiBaseUrl + '/v2/journey.retrieve' + '?' + $.param (parameters, false);
				
				// Load the route
				_loadingRouteFromId = true;
				routing.loadRoute (url, strategy, routing.processRoute);
			});
			
			// Add results tabs
			routing.resultsTabs ();
		},
		
		
		// External getter for loading route from ID status
		getLoadingRouteFromId: function ()
		{
			return _loadingRouteFromId;
		},
		
		
		// Function to load a route over AJAX
		loadRoute: function (url, strategy, callbackFunction)
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
					
					// Convert request to GeoJSON; CycleStreets is treated as the native GeoJSON format, and other engines (e.g. OSRM) are emulated to that
					const geojsonConversionFunction = 'geojsonConversion_' + strategy.implementation;
					result = routing[geojsonConversionFunction] (result, strategy.id);
					
					// For a single CycleStreets route, emulate /properties/plans present in the multiple route type
					if ((!_settings.multiplexedStrategies && !result.properties.plans) || _loadingRouteFromId) {
						result = routing.emulatePropertiesPlans (result, strategy.id);
					}
					
					// Run the callback to process the route
					callbackFunction (strategy, result);
				},
				error: function (jqXHR, textStatus, errorThrown) {
					vex.dialog.alert ('Sorry, the route for ' + strategy.label + ' could not be loaded.');
					console.log (errorThrown);
				}
			});
		},
		
		
		// GeoJSON conversion function: CycleStreets
		geojsonConversion_cyclestreets: function (result, strategy)
		{
			// Already native format; do nothing
			return result;
		},
		
		
		// GeoJSON conversion function: OSRM
		// Converts an OSRM route result to the CycleStreets GeoJSON format
		// OSRM format: https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md
		// CycleStreets format: https://www.cyclestreets.net/api/v2/journey.plan/
		geojsonConversion_osrm: function (osrm, strategy)
		{
			// Determine the number of waypoints
			const totalWaypoints = osrm.waypoints.length;
			const lastWaypoint = totalWaypoints - 1;
			
			// Start the features list
			const features = [];
			
			// First, add each waypoint as a feature
			let waypointNumber;
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
					lengthMetres: osrm.routes[0].length,
					timeSeconds: osrm.routes[0].time,
					elevationProfile: {
						cumulativeMetres: {},	// #!# Not yet implemented
						elevationsMetres: {}	// #!# Not yet implemented
					}
				},
				geometry: osrm.routes[0].geometry	// Already in GeoJSON coordinates format
			});
			
			// Next, add each step
			$.each (osrm.routes[0].legs[0].steps, function (index, step) {
				
				// Skip final arrival node
				if (step.maneuver.type == 'arrive') {return 'continue;';}
				
				// Add the feature
				features.push ({
					type: 'Feature',
					properties: {
						path: 'plan/' + strategy + '/street/' + (index + 1),
						number: (index + 1),
						name: step.name || step.ref || '[Unknown name]',
						lengthMetres: step.distance,
						timeSeconds: step.duration,
						ridingSurface: '',				// Not available in OSRM
						color: '',						// Not available in OSRM
						travelMode: (step.name.indexOf ('railway') !== -1 ? 'railway' : step.mode),
						signalledJunctions: step.intersections.length,
						signalledCrossings: -1,			// Not available in OSRM
						startBearing: step.maneuver.bearing_before
					},
					geometry: step.geometry	// Already in GeoJSON coordinates format
				});
			});
			
			// Assemble the plan summaries
			const plans = {};
			plans[strategy] = {		// Cannot be assigned directly in the array below; see https://stackoverflow.com/questions/11508463/javascript-set-object-key-by-variable
				length: osrm.routes[0].distance,
				time: osrm.routes[0].duration,
				kiloCaloriesBurned: null,	// #!# Not yet implemented
				grammesCO2saved: null		// #!# Not yet implemented
				// Others not yet added, e.g. signalledJunctions, signalledCrossings, etc.
			};
			
			// Assemble the GeoJSON structure
			const geojson = {
				type: 'FeatureCollection',
				properties: {
					id: null,							// Not available in OSRM
					start: osrm.waypoints[0].name,
					finish: osrm.waypoints[lastWaypoint].name,
					waypointCount: totalWaypoints,
					plans: plans
				},
				features: features
			};
			
			//console.log (geojson);
			//console.log (JSON.stringify (geojson));
			
			// Return the result
			return geojson;
		},
		
		
		// Function to find a plan index
		findPlanIndex: function (result, strategyId)
		{
			// Find the relevant feature
			const findPath = 'plan/' + strategyId;
			let planIndex = false;
			$.each (result.features, function (index, feature) {
				if (feature.properties.path == findPath) {
					planIndex = index;
					return;	// i.e. break
				}
			});
			
			return planIndex;
		},
		
		
		// Function to emulate /properties/plans present in the multiple route type but not the single type
		// #!# Needs to be fixed in the API V2 format
		emulatePropertiesPlans: function (result, strategyId)
		{
			// Find the relevant feature
			const planIndex = routing.findPlanIndex (result, strategyId);
			
			// Assemble the plan summaries
			const plans = {};
			plans[strategyId] = {		// Cannot be assigned directly in the array below; see https://stackoverflow.com/questions/11508463/javascript-set-object-key-by-variable
				length: result.features[planIndex].properties.lengthMetres,
				time: result.features[planIndex].properties.timeSeconds,
				grammesCO2saved: result.features[planIndex].properties.grammesCO2saved,
				kiloCaloriesBurned: result.features[planIndex].properties.kiloCaloriesBurned
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
			let coordinates;
			$.each (geojson.features, function (index, feature) {
				if (feature.properties.plan == plan && feature.geometry.type == 'LineString') {
					coordinates = feature.geometry.coordinates;
					return;		// I.e. break, as now found
				}
			});
			
			// Obtain the bounds
			const bounds = coordinates.reduce (function (bounds, coord) {
				return bounds.extend (coord);
			}, new mapboxgl.LngLatBounds (coordinates[0], coordinates[0]));
			
			// Fit bounds
			_map.fitBounds (bounds.toArray (), {padding: _settings.fitBoundsPadding, maxZoom: 17, duration: 1500});
		},
		
		
		// Function to enable/disable route planning
		// If a user plans a route and requests routing, but returns to the planning screen before
		// the AJAX call has completed, route planning can display in the incorrect mode.
		// This boolean acts as a flag which blocks the route from being displayed if we are not in itinerary mode
		plannedRouteShouldBeShown: function (boolean)
		{
			_showPlannedRoute = boolean;
		},
		
		
		// Function to render a route onto the map
		showRoute: function (geojson, strategy)
		{
			// If we are not in itinerary mode, exit
			if (!_showPlannedRoute) {
				return;
			}
			
			// Add in colours based on travel mode; see: https://www.mapbox.com/mapbox-gl-js/example/data-driven-lines/
			$.each (geojson.features, function (index, feature) {
				geojson.features[index].properties.color = routing.travelModeToColour (feature.properties.travelMode, strategy.lineColour);
			});
			
			// https://www.mapbox.com/mapbox-gl-js/example/geojson-line/
			// Data-driven styling support shown at: https://www.mapbox.com/mapbox-gl-js/style-spec/#layers-line
			const layer = {
				'id': strategy.id,
				'type': 'line',
				'source': {
					'type': 'geojson',
					'data': geojson,
					'attribution': strategy.attribution
				},
				'layout': {
					'line-join': 'round',
					'line-cap': 'round'
				},
				'paint': {
					'line-color': ['get', 'color'],
					'line-width': (strategy.id == _selectedStrategy ? _settings.lineThickness.selected : _settings.lineThickness.unselected)
				}
			};
			_map.addLayer (layer);
			
			// Add an outline for the line under the layer
			if (_settings.lineOutlines) {
				const outline = $.extend (true, {}, layer);	// i.e. clone
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
			let totalWaypoints = 0;
			$.each (geojson.features, function (index, feature) {
				if (feature.properties.path.match (/^waypoint/)) {
					totalWaypoints++;
				}
			});
			
			// Add the marker for each point
			// #!# Needs fixing to add the correct colours
			$.each (geojson.features, function (index, feature) {
				if (feature.properties.path.match (/^waypoint/)) {
					
					// Construct the marker attributes
					let label;
					switch (feature.properties.markerTag) {
						case 'start'       : label = 'waypoint0'; break;
						case 'finish'      : label = 'waypoint1'; break;
						case 'intermediate': label = false; break;
					}
					const waypoint = {lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1], label: label};
					
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
			const routeIndex = _routeIndexes[strategy.id];
			const totalStrategies = _settings.strategies.length;
			const fractionOfRoutePoint = (((routeIndex + (routeIndex + 1)) * 0.5) / totalStrategies);	// e.g. first strategy should be 1/6th of the way along the route
			const lengthUntilPoint = plan.length * fractionOfRoutePoint;
			
			// Iterate through the route to find the point along the route
			let length = 0;		// Start
			let coordinates;
			$.each (geojson.features, function (index, feature) {
				if (!feature.properties.path.match (/street/)) {return 'continue';}
				length += feature.properties.lengthMetres;
				if (length >= lengthUntilPoint) {
					coordinates = feature.geometry.coordinates[0];	// First within segment
					return false;	// break
				}
			});
			
			// Construct the HTML for the popup
			let html = '<div class="details" style="border-color: ' + strategy.lineColour + '">';
			html += '<ul><li><img src="/images/icon-clock.svg" alt="Clock icon" /><p>' + routing.formatDuration (plan.time) + '</p></li>';
			html += '<li><img src="/images/icon-cyclist.svg" alt="Cyclist icon" /><p>' + routing.formatDistance (plan.length) + '</p></li></ul>';
			html += '</div>';
			
			// Create the popup, set its coordinates, and add its HTML
			const popup = new mapboxgl.Popup ({
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
			let urlSlug = '/';
			
			// Construct the URL slug from waypoints, if any
			if (waypoints) {
				const waypointStrings = routing.waypointStrings (waypoints, 'lat,lng');	// Lat,lng order is as used historically and is as per OSM, Google Maps
				urlSlug = '/journey/' + waypointStrings.join ('/') + '/';
			}
			
			// Construct the URL slug from an itinerary ID, which takes precedence
			if (itineraryId) {
				urlSlug = '/journey/' + itineraryId + '/';
			}
			
			// Construct the URL
			let url = '';
			url += urlSlug;
			url += window.location.hash;
			
			// Construct the page title, based on the enabled layers
			let title = _settings.title;
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
				const routeWaypoints = _waypoints;
				_waypoints = [];
				_currentWaypointIndex = 0;
				$.each(routeWaypoints, function (indexInArray, waypoint) {
					// Rename the label so it matches with the geocoder input name
					waypoint.label = 'waypoint' + _currentWaypointIndex;
					const addInput = true;
					const inputHasDefaultValue = true;
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
			if (_plannerDivId) {
				$('#' + _plannerDivId + ' #results').tabs ('destroy');	// http://api.jqueryui.com/tabs/
				$('#' + _plannerDivId + ' #results').remove ();
			}
			
			// Reparse the URL
			routing.parseUrl ();
			
			// Update the URL
			routing.updateUrl (_itineraryId, null);
		},
		
		
		// Function to remove all JP inputs
		resetJPGeocoderInputs: function ()
		{
			const inputElements = $(_settings.plannerDivPath + ' input');
			$.each (inputElements, function (index, inputElement) {
				$(inputElement).parent().remove();
			});
		},
		
		
		// Function to add a waypoint marker
		// Accepts arguments: addInput: it will forcefully add a new geocoder input
		// If addInput is false, an input will only be added if there is no empty existing input
		// inputHasDefaultValue: Creates the input with val="Finding location", to avoid a timing error when many inputs are added at once and the geocoder doesn't have time to locate each one
		addWaypointMarker: function (waypoint, addInput = false, inputHasDefaultValue = false)
		{
			// Auto assign label if required; any map clicks, or externally added waypoints (e.g. from POI panel) will be received as label = null, as in these cases we don't have knowledge of the internal state of the JP panel
			let inputElements;
			if (waypoint.label == null) {
				
				// If this is the first click on the map, we want to quickly add the user's location to the first input
				// Our click will therefore populate the second input. However, this should only happen when the JP card is close.
				// If it is open, clicking on the map should always add to the first empty input
				if ($(_settings.plannerDivPath + ' input:empty').length == 2 && !$(_settings.plannerDivPath).hasClass ('open')) {
					// #!# Global object not supplied - should use a handle instead
					if (layerviewer.getGeolocationAvailability ()) {
						routing.setMarkerAtUserLocation ();
					}
				}
				
				// Is there an empty waypoint? If so, we want to associate this waypoint
				// Loop through all the inputs and find if there's an empty one
				let isEmptyInput = false;
				inputElements = $(_settings.plannerDivPath + ' input');
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
					waypoint.label = 'waypoint' + (_currentWaypointIndex + 1);

					// If addInput wasn't enabled, enable it now, so we have a input for the new marker
					addInput = true;
				}
			}
			
			// Are we replacing a current waypoint, or registering a new one?
			// Search for a waypoint with label matching our new candidate
			const waypointIndex = _waypoints.findIndex((wp) => wp.label == waypoint.label);
			
			// Get the final waypoint number
			let waypointNumber;
			if (waypoint.label) {
				waypointNumber = Number(waypoint.label.replace('waypoint',''));
			}
			
			// waypointIndex will be -1 if not matched, or else returns index of match
			if (waypointIndex > -1) {
				
				// Store old waypoint
				const oldWaypoint = _waypoints[waypointIndex];
				
				// Replace the waypoint
				_waypoints[waypointIndex] = waypoint;
				
				// Locate the previous marker, and setLngLat to new waypoint coordinates
				const markerIndex = _markers.findIndex((marker) => marker._lngLat.lng == oldWaypoint.lng && marker._lngLat.lat == oldWaypoint.lat);
				if (markerIndex > -1) {
					_markers[markerIndex].setLngLat ([waypoint.lng, waypoint.lat]);
				}
				
			} else { // We did not match any, so adding a new waypoint
				// Register the waypoint
				_waypoints.push (waypoint);
				
				// Determine the image and text to use
				let image;
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
				const text = waypoint.label;
				
				// Assemble the image as a DOM element
				// Unfortunately Mapbox GL makes image markers more difficult than Leaflet.js and has to be done at DOM level; see: https://github.com/mapbox/mapbox-gl-js/issues/656
				const itinerarymarker = document.createElement('div');
				itinerarymarker.className = 'itinerarymarker';
				itinerarymarker.style.backgroundImage = "url('" + image + "')";
				
				// Add the marker
				const marker = new mapboxgl.Marker({element: itinerarymarker, offset: [0, -22], draggable: true})	// See: https://www.mapbox.com/mapbox-gl-js/api/#marker
					.setLngLat(waypoint)
					.setPopup( new mapboxgl.Popup({offset: 25}).setHTML(text) )
					.addTo(_map);
				
				// Unofficially overload the Marker with a waypoint number property, to tie this marker to a waypoint input
				marker.__waypointNumber = waypointNumber;
				
				// When marker is dragged, perform reverseGeocode and also update the waypoints
				marker.on ('dragend', function (e) {
					// If this is the waypoint0, dragging means we are now not at the user location
					// Turn off (grayscale) the location button to show this
					if (marker.__waypointNumber == 0) {
						const inputElement = $(_settings.plannerDivPath + ' input[name=waypoint' + waypointNumber + ']').first();
						$(inputElement).siblings ('a.locationTracking').addClass ('grayscale');
					}
					
					// Build waypoint
					const label = 'waypoint' + (waypointNumber);
					const markerWaypoint = {lng: e.target._lngLat.lng, lat: e.target._lngLat.lat, label: label};
					
					// Find waypoint index
					const markerWaypointIndex = _waypoints.findIndex((wp) => wp.label == label);
					
					// Replace waypoint in _waypoints index
					_waypoints[markerWaypointIndex] = markerWaypoint;
					
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
					inputElements = $(_settings.plannerDivPath + ' input');
					let emptyInputExists = false;
					$.each (inputElements, function (index, inputElement) {
						if (!$(inputElement).val()) {
							emptyInputExists = true;
							return false;
						}
					});
					
					if (!emptyInputExists) {
						const inputName = 'waypoint' + (waypointNumber) ;
						$('#journeyPlannerInputs').append (routing.getInputHtml (inputName, inputHasDefaultValue));
						
						// Register a handler for geocoding, attachable to any input
						routing.geocoder (_settings.plannerDivPath + ' input[name="' + inputName + '"]', function (item, callbackData) {
							
							// Add the waypoint marker
							const waypointMarker = {lng: item.lon, lat: item.lat, label: inputName};
							routing.addToRecentSearches (waypointMarker);
							routing.addWaypointMarker (waypoint);
							
						}, {_currentWaypointIndex: _currentWaypointIndex});
						
						// Rescan and fix colour
						routing.sortWaypoints();
					}
				}
			}
			
			// After any additional input are created, perform the reverse geocode
			routing.reverseGeocode (waypoint, waypointNumber);
		},
		
		
		/* 	Function to mark a single marker, i.e., house or work, or photomap upload location
			While in this mode, only one marker can be displayed on the screen
			If any Journey Planner markers were being displayed when this mode started, they will be saved and restored after we have set the location
		*/
		setFrequentLocation: function (waypoint, type)
		{
			// Overwrite the single marker location
			_singleMarkerLocation = [];
			_singleMarkerLocation.push (waypoint);

			// #!# Add custom work/home markers?
			const image = _settings.images.start;
			
			// Assemble the image as a DOM element
			const itinerarymarker = document.createElement('div');
			itinerarymarker.className = 'itinerarymarker';
			itinerarymarker.style.backgroundImage = "url('" + image + "')";
			
			// Add the marker
			const marker = new mapboxgl.Marker({element: itinerarymarker, offset: [0, -22], draggable: true})	// See: https://www.mapbox.com/mapbox-gl-js/api/#marker
				.setLngLat(waypoint)
				.addTo(_map);
			
			// Perform a reverse geocoding of the marker location initially
			routing.reverseGeocode (waypoint, 'FrequentLocation'); // This overloads the reversegeocoder, which ties to input name 'waypoint' + waypointNumber
			
			// When marker is dragged, perform reverseGeocode and also update the waypoints
			marker.on ('dragend', function (e) {
				// Build waypoint
				const waypointDragged = {lng: e.target._lngLat.lng, lat: e.target._lngLat.lat, label: null};
				
				// Update the location of the single marker
				routing.setFrequentLocation (waypointDragged, type);
				
				// Reverse geocode to fill input box
				routing.reverseGeocode (e.target._lngLat, 'FrequentLocation'); // This overloads the reversegeocoder, which ties to input name 'waypoint' + waypointNumber
			});
			
			// Overwrite any other single location markers (leave and JP markers intact)
			$.each(_markers, function (indexInArray, marker) {
				if (!marker.hasOwnProperty('waypointNumber')) {marker.remove ();}
			});
			
			_markers.push (marker);
		},
		
		
		// Function to reset the frequent location, used to reset this variable after operation is finihsed
		resetFrequentLocation: function ()
		{
			// Remove the single marker location
			_singleMarkerLocation = [];
			
			// Overwrite any other single location markers (leave any JP markers intact)
			$.each(_markers, function (indexInArray, marker) {
				if (!marker.hasOwnProperty('waypointNumber')) {marker.remove ();}
			});
		},
		
		
		// Function to reverse geocode a location
		reverseGeocode: function (coordinates, waypointNumber)
		{
			// Assemble API URL; see: https://www.cyclestreets.net/api/v2/nearestpoint/
			let reverseGeocoderApiUrl = routing.settingsPlaceholderSubstitution (_settings.reverseGeocoderApiUrl, ['apiBaseUrl', 'apiKey']);
			reverseGeocoderApiUrl += '&lonlat=' + coordinates.lng + ',' + coordinates.lat;
			
			// Divine the input element, which will be used to control the spinner loader
			const inputElement = $(_settings.plannerDivPath + ' input[name=waypoint' + waypointNumber + ']').first();
			
			// Fetch the result
			$.ajax ({
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
			const d = new Date ();
			d.setTime (d.getTime () + (days * 24 * 60 * 60 * 1000));
			const expires = 'expires=' + d.toUTCString();
			document.cookie = name + '=' + value + ';' + expires + ';path=/';
		},
		
		
		// Function to get a cookie's value; see: https://www.w3schools.com/js/js_cookies.asp
		getCookie: function (name)
		{
			const cname = name + '=';
			const decodedCookie = decodeURIComponent (document.cookie);
			const ca = decodedCookie.split (';');
			let i;
			let c;
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

