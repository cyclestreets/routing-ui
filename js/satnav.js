// CycleStreets HTML5 satnav in a browser

/*jslint browser: true, white: true, single: true, for: true */
/*global $, alert, console, window, FULLTILT */

var satnav = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	var _settings = {
		
		// CycleStreets API key
		cyclestreetsApiKey: 'YOUR_CYCLESTREETS_API_KEY',
		
		// Mapbox API key
		mapboxApiKey: 'YOUR_MAPBOX_API_KEY',
		
		// Initial lat/lon/zoom of map and tile layer
		defaultLocation: {
			latitude: 54.235,
			longitude: -1.582,
			zoom: 5
		}
	};
	
	// Internal class properties
	var _map = null;
	
	
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
			
			// Create the map
			satnav.createMap ();
			
			// Enable tilt and direction
			satnav.enableTilt ();
			
			// Add a geolocation control
			satnav.geolocation ();
			
			// Add layer switching
			satnav.layerSwitcher ();
			
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
				style: 'mapbox://styles/mapbox/streets-v9',
				center: [_settings.defaultLocation.longitude, _settings.defaultLocation.latitude],
				zoom: _settings.defaultLocation.zoom,
				hash: true
			});
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
					
					// Get the current *screen-adjusted* device orientation angles
					var currentOrientation = deviceOrientation.getScreenAdjustedEuler ();
					
					// Calculate the current compass heading that the user is 'looking at' (in degrees)
					var compassHeading = 360 - currentOrientation.alpha;
					
					// Set the bearing and pitch
					_map.setBearing (compassHeading);
					_map.setPitch (currentOrientation.beta);
				});
				
			}).catch (function (errorMessage) { // Device Orientation Events are not supported
				console.log (errorMessage);
			});
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
		
		
		// Function to add layer switching
		// https://www.mapbox.com/mapbox-gl-js/example/setstyle/
		// https://bl.ocks.org/ryanbaumann/7f9a353d0a1ae898ce4e30f336200483/96bea34be408290c161589dcebe26e8ccfa132d7
		layerSwitcher: function ()
		{
			// Define the available layers
			var layers = {
				
				// Mapbox vector styles
				"streets": 'mapbox://styles/mapbox/streets-v9',
				"bright": 'mapbox://styles/mapbox/bright-v9',
				"dark": 'mapbox://styles/mapbox/dark-v9',
				"satellite": 'mapbox://styles/mapbox/satellite-v9',
				
				// Raster styles; see: https://www.mapbox.com/mapbox-gl-js/example/map-tiles/
				// NB If using only third-party sources, a Mapbox API key is not needed: see: https://github.com/mapbox/mapbox-gl-native/issues/2996#issuecomment-155483811
				"opencyclemap": {
					"version": 8,
					"sources": {
						"simple-tiles": {
							"type": "raster",
							"tiles": [
								"https://a.tile.cyclestreets.net/opencyclemap/{z}/{x}/{y}.png",
								"https://b.tile.cyclestreets.net/opencyclemap/{z}/{x}/{y}.png",
								"https://c.tile.cyclestreets.net/opencyclemap/{z}/{x}/{y}.png",
							],
							"tileSize": 256
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
			
			// Switch to selected layer
			var layerList = document.getElementById('menu');
			var inputs = layerList.getElementsByTagName('input');
			function switchLayer (layer) {
				var layerId = layer.target.id;
				var style = layers[layerId];
				_map.setStyle (style);
			};
			for (var i = 0; i < inputs.length; i++) {
				inputs[i].onclick = switchLayer;
			}
		},
		
		
		// Function to add routing
		routing: function ()
		{
			// For now, obtain a fixed GeoJSON string
			var url = 'https://api.cyclestreets.net/v2/journey.retrieve?itinerary=63238303&plans=balanced&key=' + _settings.cyclestreetsApiKey;
			
			// https://www.mapbox.com/mapbox-gl-js/example/geojson-line/
			var route = {
				"source": {
					"type": "geojson",
					"data": url,
				},
				"layer": {
					"id": "route",
					"source": "route",
					"type": "line",
					"layout": {
						"line-join": "round",
						"line-cap": "round"
					},
					"paint": {
						"line-color": "purple",
						"line-width": 8
					}
				}
			}
				
			// https://bl.ocks.org/ryanbaumann/7f9a353d0a1ae898ce4e30f336200483/96bea34be408290c161589dcebe26e8ccfa132d7
			_map.on ('style.load', function () {
				_map.addSource (route.layer.source, route.source);
				_map.addLayer (route.layer);
			});
		},
		
		
		// Buildings layer
		// https://www.mapbox.com/mapbox-gl-js/example/3d-buildings/
		addBuildings: function ()
		{
			// The 'building' layer in the mapbox-streets vector source contains building-height data from OpenStreetMap.
			_map.on('style.load', function() {
				// Insert the layer beneath any symbol layer.
				var layers = _map.getStyle().layers;
				
				var labelLayerId;
				for (var i = 0; i < layers.length; i++) {
					if (layers[i].type === 'symbol' && layers[i].layout['text-field']) {
						labelLayerId = layers[i].id;
						break;
					}
				}
				
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
		}
	};
	
} (jQuery));

