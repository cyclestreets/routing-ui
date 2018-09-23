// CycleStreets HTML5 satnav in a browser

/*jslint browser: true, white: true, single: true, for: true */
/*global $, alert, console, window, FULLTILT */

var satnav = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	var _settings = {
		
		// CycleStreets API
		cyclestreetsApiBaseUrl: 'https://api.cyclestreets.net',
		cyclestreetsApiKey: 'YOUR_CYCLESTREETS_API_KEY',
		
		// Mapbox API key
		mapboxApiKey: 'YOUR_MAPBOX_API_KEY',
		
		// Initial lat/lon/zoom of map and tile layer
		defaultLocation: {
			latitude: 54.235,
			longitude: -1.582,
			zoom: 5
		},
		
		// Max zoom
		maxZoom: 20,
		
		// Geocoder API URL; re-use of settings values represented as placeholders {%cyclestreetsApiBaseUrl}, {%cyclestreetsApiKey}, {%autocompleteBbox}, are supported
		geocoderApiUrl: '{%cyclestreetsApiBaseUrl}/v2/geocoder?key={%cyclestreetsApiKey}&bounded=1&bbox={%autocompleteBbox}',
		
		// BBOX for autocomplete results biasing
		autocompleteBbox: '-6.6577,49.9370,1.7797,57.6924',
		
		// Default style
		defaultStyle: 'OpenCycleMap'
	};
	
	// Internal class properties
	var _map = null;
	var _urlParameters = {};
	var _styles = {};
	var _itineraryId = null;
	var _markers = [];
	var _routeGeojson = false;
	var _panningEnabled = false;
	
	
	return {
		
		// Main entry point
		initialise: function (config)
		{
			// Merge the configuration into the settings
			$.each (_settings, function (setting, value) {
				if (config.hasOwnProperty(setting)) {
					_settings[setting] = config[setting];
				}
			});
			
			// Parse the URL
			satnav.parseUrl ();
			
			// Load styles
			satnav.getStyles ();
			
			// Create the map
			satnav.createMap ();
			
			// Enable tilt and direction
			satnav.enableTilt ();
			
			// Geolocate the user initially
			satnav.geolocateInitial ();
			
			// Add a geolocation control
			satnav.geolocation ();
			
			// Add layer switching
			satnav.layerSwitcher ();
			
			// Add geocoder control
			satnav.geocoder ();
			
			// Add toolbox (pending implementation of overall UI)
			satnav.toolbox ();
			
			// Add panning control
			satnav.controlPanning ();
			
			// Add route clearing
			satnav.routeClearing ();
			
			// Load route from URL if present
			satnav.loadRouteInitialUrl ();
			
			// Add load route ID functionality
			satnav.loadRouteId ();
			
			// Add buildings
			satnav.addBuildings ();
			
			// Add routing
			satnav.routing ();
		},
		
		
		// Create map; see: https://www.mapbox.com/mapbox-gl-js/example/simple-map/
		createMap: function ()
		{
			// Create map, specifying the access token
			mapboxgl.accessToken = _settings.mapboxApiKey;
			_map = new mapboxgl.Map ({
				container: 'map',
				style: _styles[_settings.defaultStyle],
				center: [_settings.defaultLocation.longitude, _settings.defaultLocation.latitude],
				zoom: _settings.defaultLocation.zoom,
				maxZoom: _settings.maxZoom,
				hash: true
			});
			
			// Enable zoom in/out buttons
			_map.addControl (new mapboxgl.NavigationControl ());
		},
		
		
		// Function to tilt and orientate the map direction based on the phone position
		// Note that the implementation of the W3C spec is inconsistent and is split between "world-orientated" and "game-orientated" implementations; accordingly a library is used
		// https://developer.mozilla.org/en-US/docs/Web/API/Detecting_device_orientation
		// https://developers.google.com/web/fundamentals/native-hardware/device-orientation/
		// https://stackoverflow.com/a/26275869/180733
		// https://www.w3.org/2008/geolocation/wiki/images/e/e0/Device_Orientation_%27alpha%27_Calibration-_Implementation_Status_and_Challenges.pdf
		enableTilt: function ()
		{
			// Obtain a new *world-oriented* Full Tilt JS DeviceOrientation Promise
			var promise = FULLTILT.getDeviceOrientation ({ 'type': 'world' });

			// Wait for Promise result
			promise.then (function (deviceOrientation) { // Device Orientation Events are supported
				
				// Register a callback to run every time a new deviceorientation event is fired by the browser.
				deviceOrientation.listen (function() {
					
					// Disable if required
					// #!# For efficiency, disabling panning should disable this whole function, using FULLTILT.DeviceOrientation.stop() / .start(), rather than just at the final point here
					if (_panningEnabled) {
						
						// Get the current *screen-adjusted* device orientation angles
						var currentOrientation = deviceOrientation.getScreenAdjustedEuler ();
						
						// Calculate the current compass heading that the user is 'looking at' (in degrees)
						var compassHeading = 360 - currentOrientation.alpha;
						
						// Set the bearing and pitch
						_map.setBearing (compassHeading);
						_map.setPitch (currentOrientation.beta);
					}
				});
				
			}).catch (function (errorMessage) { // Device Orientation Events are not supported
				console.log (errorMessage);
			});
		},
		
		
		// Function to geolocate the user initially
		// https://stackoverflow.com/a/46340826/180733
		geolocateInitial: function ()
		{
			// Define geolocation options
			var options = {
				enableHighAccuracy: true,
				timeout: 5000,
				maximumAge: 0
			};
			
			function success (pos) {
				var crd = pos.coords;
				_map.flyTo ({
					center: [crd.longitude, crd.latitude],
					zoom: 15
				});
			};
			
			function error (err) {
				console.log (err);
			}

			navigator.geolocation.getCurrentPosition (success, error, options);
			
		},
		
		
		// Function to add a geolocation control
		// https://www.mapbox.com/mapbox-gl-js/example/locate-user/
		// https://github.com/mapbox/mapbox-gl-js/issues/5464
		geolocation: function ()
		{
			// Create a tracking control
			var geolocate = new mapboxgl.GeolocateControl({
				positionOptions: {
					enableHighAccuracy: true
				},
				trackUserLocation: true
			});
			
			// Add to the map
			_map.addControl (geolocate);
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
		
		
		// Define styles
		getStyles: function ()
		{
			// Define the available background styles
			_styles = {
				
				// Mapbox vector styles
				"streets": 'mapbox://styles/mapbox/streets-v9',
				"bright": 'mapbox://styles/mapbox/bright-v9',
				"dark": 'mapbox://styles/mapbox/dark-v9',
				"satellite": 'mapbox://styles/mapbox/satellite-v9',
				
				// Raster styles; see: https://www.mapbox.com/mapbox-gl-js/example/map-tiles/
				// NB If using only third-party sources, a Mapbox API key is not needed: see: https://github.com/mapbox/mapbox-gl-native/issues/2996#issuecomment-155483811
				"OpenCycleMap": {
					"version": 8,
					"sources": {
						"simple-tiles": {
							"type": "raster",
							"tiles": [
								"https://a.tile.cyclestreets.net/opencyclemap/{z}/{x}/{y}.png",
								"https://b.tile.cyclestreets.net/opencyclemap/{z}/{x}/{y}.png",
								"https://c.tile.cyclestreets.net/opencyclemap/{z}/{x}/{y}.png",
							],
							"tileSize": 256,
							"attribution": 'Maps © <a href="https://www.thunderforest.com/">Thunderforest</a>, Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
						}
					},
					"layers": [{
						"id": "simple-tiles",
						"type": "raster",
						"source": "simple-tiles",
						"minzoom": 0,
						"maxzoom": 22
					}]
				}
			}
		},
		
		
		// Function to add layer switching
		// https://www.mapbox.com/mapbox-gl-js/example/setstyle/
		// https://bl.ocks.org/ryanbaumann/7f9a353d0a1ae898ce4e30f336200483/96bea34be408290c161589dcebe26e8ccfa132d7
		layerSwitcher: function ()
		{
			// Add layer switcher UI
			var control = this.createControl ('layerswitcher', 'bottom-left');

			// Construct HTML for layer switcher
			var layerSwitcherHtml = '<ul>';
			var name;
			$.each (_styles, function (styleId, style) {
				name = satnav.ucfirst (styleId);
				layerSwitcherHtml += '<li><input id="' + styleId + '" type="radio" name="layerswitcher" value="' + styleId + '"' + (styleId == _settings.defaultStyle ? ' checked="checked"' : '') + '><label for="' + styleId + '"> ' + name + '</label></li>';
			});
			layerSwitcherHtml += '</ul>';
			$('#layerswitcher').append (layerSwitcherHtml);
			
			// Switch to selected layer
			var layerList = document.getElementById ('layerswitcher');
			var inputs = layerList.getElementsByTagName ('input');
			function switchLayer (layer) {
				var layerId = layer.target.id;
				var style = _styles[layerId];
				_map.setStyle (style);
			};
			for (var i = 0; i < inputs.length; i++) {
				inputs[i].onclick = switchLayer;
			}
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
		
		
		// Wrapper function to add a geocoder control
		geocoder: function ()
		{
			// Geocoder URL; re-use of settings values is supported, represented as placeholders {%cyclestreetsApiBaseUrl}, {%cyclestreetsApiKey}, {%autocompleteBbox}
			var geocoderApiUrl = satnav.settingsPlaceholderSubstitution (_settings.geocoderApiUrl, ['cyclestreetsApiBaseUrl', 'cyclestreetsApiKey', 'autocompleteBbox']);
			
			// Attach the autocomplete library behaviour to the location control
			autocomplete.addTo ('#geocoder input', {
				sourceUrl: geocoderApiUrl,
				select: function (event, ui) {
					var bbox = ui.item.feature.properties.bbox.split(',');
					_map.setMaxZoom (18);	// Prevent excessive zoom to give context
					_map.fitBounds([ [bbox[0], bbox[1]], [bbox[2], bbox[3]] ]);	// Note that Mapbox GL JS uses sw,ne rather than ws,en as in Leaflet.js
					_map.setMaxZoom (_settings.maxZoom);	// Reset
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
				satnav.setPanningIndicator ();
			});
*/
			
			// Toggle panning on/off, and update the control
			$('#panning').on ('click', function () {
				_panningEnabled = !_panningEnabled;
				satnav.setPanningIndicator ();
				
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
					satnav.removeRoute ();
					
					// Hide clear route link
					$('#clearroute').hide ();
				}
			});
		},
		
		
		loadRouteInitialUrl: function ()
		{
			// Load the route if an itinerary ID is set
			if (_urlParameters.itineraryId) {
				_itineraryId = _urlParameters.itineraryId;
				satnav.loadRouteFromId (_itineraryId);
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
					satnav.removeRoute ();
				}
				
				// For now, request an itinerary ID if not already entered, or end
				_itineraryId = prompt ('CycleStreets journey number?', '63248473');
				if (!_itineraryId) {return;}
				
				// Load the route
				satnav.loadRouteFromId (_itineraryId);
				
				// Prevent link following
				e.preventDefault ();
			});
		},
		
		
		// Function to add routing
		routing: function ()
		{
			// Load routing when style ready
			_map.on ('style.load', function () {
				
				// If the route is already loaded, show it
				if (_routeGeojson) {
					satnav.showRoute (_routeGeojson);
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
					satnav.addWaypointMarker (e.lngLat, totalWaypoints, label, totalWaypoints);
					
					// Once there are two waypoints, load the route
					if (totalWaypoints == 2) {
						
						// Load the route
						satnav.loadRouteFromWaypoints (waypoints);
						
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
			satnav.loadRoute (url, false);
		},
		
		
		// Function to load a route from a specified itinerary ID
		loadRouteFromId: function (itineraryId)
		{
			// For now, obtain a fixed GeoJSON string
			var url = _settings.cyclestreetsApiBaseUrl + '/v2/journey.retrieve?itinerary=' + itineraryId + '&plans=balanced&key=' + _settings.cyclestreetsApiKey;
			
			// Load the route
			satnav.loadRoute (url, true);
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
					satnav.showRoute (_routeGeojson);
					
					// Set the itinerary number permalink in the URL
					var itineraryId = _routeGeojson.properties.id;
					satnav.updateUrl (itineraryId);
					
					// Fit bounds if required
					if (fitBounds) {
						satnav.fitBoundsGeojson (_routeGeojson, 'balanced');
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
			_map.fitBounds (bounds, {padding: 20});
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
					satnav.addWaypointMarker (marker.geometry.coordinates, marker.properties.waypoint, text, totalWaypoints);
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
						satnav.removeRoute ();
						
						// Load the route from the waypoints
						satnav.loadRouteFromWaypoints (waypoints);
						
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
			satnav.parseUrl ();
			
			// Update the URL
			satnav.updateUrl (_itineraryId);
		},
		
		
		// Function to add a waypoint marker
		addWaypointMarker: function (coordinates, waypointNumber, label, totalWaypoints)
		{
			// Determine the image and text to use
			var image;
			var text;
			switch (waypointNumber) {
				case 1:
					image = 'start';
					text = 'Start at: <strong>' + satnav.htmlspecialchars (label) + '</strong>';
					break;
				case totalWaypoints:
					image = 'finish';
					text = 'Finish at: <strong>' + satnav.htmlspecialchars (label) + '</strong>';
					break;
				default:
					image = 'waypoint';
					text = 'Via: Waypoint #' + (waypointNumber - 1);	// #!# API needs to provide street location name
					break;
			}
			
			// Assemble the image as a DOM element
			var wisp = document.createElement('div');
			wisp.className = 'wisp';
			wisp.style.backgroundImage = "url('/images/itinerarymarkers/" + image + "-large.png')";
			
			// Add the marker
			var marker = new mapboxgl.Marker({element: wisp, offset: [0, -22], draggable: true})	// See: https://www.mapbox.com/mapbox-gl-js/api/#marker
				.setLngLat(coordinates)
				.setPopup( new mapboxgl.Popup({ offset: 25 }).setHTML(text) )
				.addTo(_map);
			
			// Register the marker
			_markers.push (marker);
		},
		
		
		// Buildings layer
		// https://www.mapbox.com/mapbox-gl-js/example/3d-buildings/
		addBuildings: function ()
		{
			// The 'building' layer in the mapbox-streets vector source contains building-height data from OpenStreetMap.
			_map.on('style.load', function() {
				
				// Get the layers in the source style
				var layers = _map.getStyle().layers;
				
				// Ensure the layer has buildings, or end
				if (!satnav.styleHasLayer (layers, 'building')) {return;}
				
				// Insert the layer beneath any symbol layer.
				var labelLayerId;
				for (var i = 0; i < layers.length; i++) {
					if (layers[i].type === 'symbol' && layers[i].layout['text-field']) {
						labelLayerId = layers[i].id;
						break;
					}
				}
				
				// Add the layer
				_map.addLayer ({
					'id': '3d-buildings',
					'source': 'composite',
					'source-layer': 'building',
					'filter': ['==', 'extrude', 'true'],
					'type': 'fill-extrusion',
					'minzoom': 15,
					'paint': {
						'fill-extrusion-color': '#aaa',
						
						// Use an 'interpolate' expression to add a smooth transition effect to the buildings as the user zooms in
						'fill-extrusion-height': [
							"interpolate", ["linear"], ["zoom"],
							15, 0,
							15.05, ["get", "height"]
						],
						'fill-extrusion-base': [
							"interpolate", ["linear"], ["zoom"],
							15, 0,
							15.05, ["get", "min_height"]
						],
						'fill-extrusion-opacity': .6
					}
				}, labelLayerId);
			});
		},
		
		
		// Function to test whether a style has a layer
		styleHasLayer: function (layers, layerName)
		{
			// Ensure the layer has buildings, or end
			for (var i = 0; i < layers.length; i++) {
				if (layers[i].id == layerName) {
					return true;
				}
			}
			
			// Not found
			return false;
		},
		
		
		// Function to make data entity-safe
		htmlspecialchars: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		},
		
		
		// Function to make first character upper-case; see: https://stackoverflow.com/a/1026087/180733
		ucfirst: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.charAt(0).toUpperCase() + string.slice(1);
		},
	};
	
} (jQuery));

