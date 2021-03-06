// Journey planner demo

/*jslint browser: true, white: true, single: true, for: true */
/*global $, jQuery, alert, console, window, DeviceOrientationEvent, mapboxgl, autocomplete, FULLTILT, routing */



// TODO:
// #!# Speech synthesis: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API#Demo_2
// #!# No-sleep: https://github.com/richtr/NoSleep.js


var journeyplanner = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	var _settings = {
		
		// CycleStreets API
		apiBaseUrl: 'https://api.cyclestreets.net',
		apiKey: 'YOUR_CYCLESTREETS_API_KEY',
		
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
		
		// Geocoder API URL; re-use of settings values represented as placeholders {%apiBaseUrl}, {%apiKey}, {%autocompleteBbox}, are supported
		geocoderApiUrl: '{%apiBaseUrl}/v2/geocoder?key={%apiKey}&bounded=1&bbox={%autocompleteBbox}',
		
		// BBOX for autocomplete results biasing
		autocompleteBbox: '-6.6577,49.9370,1.7797,57.6924',
		
		// Tileservers; historical map sources are listed at: https://wiki.openstreetmap.org/wiki/National_Library_of_Scotland
		// Raster styles; see: https://www.mapbox.com/mapbox-gl-js/example/map-tiles/
		// NB If using only third-party sources, a Mapbox API key is not needed: see: https://github.com/mapbox/mapbox-gl-native/issues/2996#issuecomment-155483811
		defaultStyle: 'opencyclemap',
		tileUrls: {
			"streets": {
				vectorTiles: 'mapbox://styles/mapbox/streets-v11',
				label: 'Streets'
			},
			"bright": {
				vectorTiles: 'mapbox://styles/mapbox/bright-v9',
				label: 'Bright'
			},
			"dark": {
				vectorTiles: 'mapbox://styles/mapbox/dark-v10',
				label: 'Night'
			},
			"satellite": {
				vectorTiles: 'mapbox://styles/mapbox/satellite-v9',
				label: 'Satellite'
			},
			"os": {
				vectorTiles: 'https://s3-eu-west-1.amazonaws.com/tiles.os.uk/styles/open-zoomstack-outdoor/style.json',
				label: 'Ordnance Survey'
			},
			"opencyclemap": {
				tiles: 'https://{s}.tile.cyclestreets.net/opencyclemap/{z}/{x}/{y}@2x.png',
				maxZoom: 22,
				attribution: 'Maps © <a href="https://www.thunderforest.com/">Thunderforest</a>, Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
				tileSize: 256,		// 512 also works but 256 gives better map detail
				label: 'OpenCycleMap'
			}
		},
		
		// Images; size set in CSS with .itinerarymarker
		images: {
			start: '/images/wisps/start.png',
			waypoint: '/images/wisps/waypoint.png',
			finish: '/images/wisps/finish.png'
		}
	};
	
	// Internal class properties
	var _map = null;
	var _isMobileDevice = false;
	var _styles = {};
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
			
			// Determine if the interface is a mobile interface
			_isMobileDevice = journeyplanner.isMobileDevice ();
			
			// Load pull-up Card UI for mobile
			journeyplanner.mobileCardUi ();
			
			// Load styles
			journeyplanner.getStyles ();
			
			// Create the map
			journeyplanner.createMap ();
			
			// Enable tilt and direction
			journeyplanner.enableTilt ();
			
			// Add buildings
			journeyplanner.addBuildings ();
			
			// Geolocate the user initially
			journeyplanner.geolocateInitial ();
			
			// Add a geolocation control
			journeyplanner.geolocation ();
			
			// Add layer switching
			journeyplanner.layerSwitcher ();
			
			// Add move-to control
			journeyplanner.addMoveToControl ();
			
			// Add routing
			journeyplanner.routing ();
		},
		
		
		// Function to detect whether a mobile device; see: https://coderwall.com/p/i817wa/one-line-function-to-detect-mobile-devices-with-javascript
		isMobileDevice: function ()
		{
			return (typeof window.orientation !== 'undefined') || (navigator.userAgent.indexOf('IEMobile') !== -1);
		},
		
		
		// Function to create a pull-up Card UI
		mobileCardUi: function ()
		{
			// End if not a mobile device
			if (!_isMobileDevice) {return;}
			
			// Make visible, as normally hidden by CSS
			$('#card').show();
			
			// Make draggable; see: https://jqueryui.com/draggable/
			// Requires the the jQuery UI Touch Punch monkey-patch; see: https://stackoverflow.com/a/13940644/180733
			$('#card').draggable ({
				axis: 'y',
				containment: [0, 50, 0, $(window).height() - 35],
				scroll: false,
				cancel: ''	// Remove default selectors to enable these to be part of the overall draggability; see: https://stackoverflow.com/questions/26756771/
			});
			
			// Exempt input from draggable; see: https://stackoverflow.com/a/26757725/180733
			$('#card').on ('click touch', 'input', function() {	// Late binding, as input created dynamically
				$(this).focus();
			});
			
/*
			// See: http://jsfiddle.net/tovic/mkUJf/
			$('#card').on ('mousedown touchstart', function(e) {
				
				// Prevent whole page scrolling, exemmpting interactive widgets to prevent non-clickability
				if ((e.target.tagName != 'INPUT') && (e.target.tagName != 'A')) {	// https://stackoverflow.com/a/27234803/180733
					e.preventDefault ();
				}
				
				// Make draggable
				$(this).addClass('draggable').parents().on('mousemove touchmove', function(e) {
					
					// Avoid text on page being highlighted; see: https://stackoverflow.com/a/5432363/180733
					e.preventDefault();
					
					// Get the location, and constrain to just below the bottom and just above the top
					var top = e.pageY;
					top = Math.max(top, 50);
					top = Math.min(top, $(window).height() - 35);
					
					// Make draggable
					$('.draggable').offset({
						top: top,
						left: 0
					}).on('mouseup touchend', function() {
						$(this).removeClass('draggable');
					});
				});
			}).on('mouseup touchend', function() {
				$('.draggable').removeClass('draggable');
			});
*/
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
		
		
		// Wrapper to enable tilt
		enableTilt: function ()
		{
			// Request permission where required on iOS13 and other supporting browsers; see:
			// https://github.com/w3c/deviceorientation/issues/57
			// https://dev.to/li/how-to-requestpermission-for-devicemotion-and-deviceorientation-events-in-ios-13-46g2
			$('body').on ('click', '#panning', function () {
				if (typeof DeviceOrientationEvent.requestPermission === 'function') {
					DeviceOrientationEvent.requestPermission()
						.then ( (permissionState) => {
							if (permissionState === 'granted') {
								journeyplanner.implementTilt ();
							}
						})
						.catch (console.error);
				} else {
					journeyplanner.implementTilt ();
				}
			});
		},
		
		
		// Function to tilt and orientate the map direction automatically based on the phone position
		// Note that the implementation of the W3C spec is inconsistent and is split between "world-orientated" and "game-orientated" implementations; accordingly a library is used
		// https://developer.mozilla.org/en-US/docs/Web/API/Detecting_device_orientation
		// https://developers.google.com/web/fundamentals/native-hardware/device-orientation/
		// https://stackoverflow.com/a/26275869/180733
		// https://www.w3.org/2008/geolocation/wiki/images/e/e0/Device_Orientation_%27alpha%27_Calibration-_Implementation_Status_and_Challenges.pdf
		implementTilt: function ()
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
		
		
		// Setter for panningEnabled
		setPanningEnabled: /* public */ function (panningEnabled)
		{
			_panningEnabled = panningEnabled;
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
				if (!journeyplanner.styleHasLayer (layers, 'building')) {return;}
				
				// Insert the layer beneath any symbol layer.
				var labelLayerId;
				var i;
				for (i = 0; i < layers.length; i++) {
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
						'fill-extrusion-opacity': 0.6
					}
				}, labelLayerId);
			});
		},
		
		
		// Function to test whether a style has a layer
		styleHasLayer: function (layers, layerName)
		{
			// Ensure the layer has buildings, or end
			var i;
			for (i = 0; i < layers.length; i++) {
				if (layers[i].id == layerName) {
					return true;
				}
			}
			
			// Not found
			return false;
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
			}
			
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
		
		
		// Define styles
		getStyles: function ()
		{
			// Register each tileset
			$.each (_settings.tileUrls, function (tileLayerId, tileLayerAttributes) {
				
				// Vector tiles
				if (tileLayerAttributes.vectorTiles) {
					_styles[tileLayerId] = tileLayerAttributes.vectorTiles;
					
				// Traditional bitmap tiles
				} else {
					
					// Convert {s} server to a,b,c if present
					if (tileLayerAttributes.tiles.indexOf('{s}') != -1) {
						tileLayerAttributes.tiles = [
							tileLayerAttributes.tiles.replace ('{s}', 'a'),
							tileLayerAttributes.tiles.replace ('{s}', 'b'),
							tileLayerAttributes.tiles.replace ('{s}', 'c')
						];
					}
					
					// Convert string (without {s}) to array
					if (typeof tileLayerAttributes.tiles === 'string') {
						tileLayerAttributes.tiles = [
							tileLayerAttributes.tiles
						];
					}
					
					// Register the definition
					_styles[tileLayerId] = {
						"version": 8,
						"sources": {
							"raster-tiles": {
								"type": "raster",
								"tiles": tileLayerAttributes.tiles,
								"tileSize": (tileLayerAttributes.tileSize ? tileLayerAttributes.tileSize : 256),	// NB Mapbox GL default is 512
								"attribution": tileLayerAttributes.attribution
							}
						},
						"layers": [{
							"id": "simple-tiles",
							"type": "raster",
							"source": "raster-tiles",
							"minzoom": 0,
							// #!# Something is causing maxzoom not to be respected
							"maxzoom": (tileLayerAttributes.maxZoom ? tileLayerAttributes.maxZoom : 22)
						}]
					};
				}
			});
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
				name = (_settings.tileUrls[styleId].label ? _settings.tileUrls[styleId].label : journeyplanner.ucfirst (styleId));
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
				
				// Fire an event; see: https://javascript.info/dispatch-events
				journeyplanner.styleChanged ();
			}
			var i;
			for (i = 0; i < inputs.length; i++) {
				inputs[i].onclick = switchLayer;
			}
		},
		
		
		// Function to trigger style changed, checking whether it is actually loading; see: https://stackoverflow.com/a/47313389/180733
		// Cannot use _map.on(style.load) directly, as that does not fire when loading a raster after another raster: https://github.com/mapbox/mapbox-gl-js/issues/7579
		styleChanged: function ()
		{
			// Delay for 200 minutes in a loop until the style is loaded; see: https://stackoverflow.com/a/47313389/180733
			if (!_map.isStyleLoaded()) {
				setTimeout (function () {
					journeyplanner.styleChanged ();	// Done inside a function to avoid "Maximum Call Stack Size Exceeded"
				}, 250);
				return;
			}
			
			// Fire a custom event that client code can pick up when the style is changed
			var body = document.getElementsByTagName ('body')[0];
			var myEvent = new Event ('style-changed', {'bubbles': true});
			body.dispatchEvent (myEvent);
		},
		
		
		// Function to make first character upper-case; see: https://stackoverflow.com/a/1026087/180733
		ucfirst: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.charAt(0).toUpperCase() + string.slice(1);
		},
		
		
		// Function to create a control in a corner
		// See: https://www.mapbox.com/mapbox-gl-js/api/#icontrol
		createControl: function (id, position, className)
		{
			var myControl = function () {};
			
			myControl.prototype.onAdd = function() {
				this._container = document.createElement('div');
				this._container.setAttribute ('id', id);
				this._container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl local';
				if (className) {
					this._container.className += ' ' + className;
				}
				return this._container;
			};
			
			myControl.prototype.onRemove = function () {
				this._container.parentNode.removeChild(this._container);
			};
			
			// #!# Need to add icon and hover; partial example at: https://github.com/schulzsebastian/mapboxgl-legend/blob/master/index.js
			
			// Instiantiate and add the control
			_map.addControl (new myControl (), position);
		},
		
		
		// Move-to control
		addMoveToControl: function ()
		{
			journeyplanner.geocoder ('#geocoder input', false);
		},
		
		
		// Function to add a geocoder control
		geocoder: function (addTo, callbackFunction)
		{
			// Geocoder URL; re-use of settings values is supported, represented as placeholders {%apiBaseUrl}, {%apiKey}, {%autocompleteBbox}
			var geocoderApiUrl = journeyplanner.settingsPlaceholderSubstitution (_settings.geocoderApiUrl, ['apiBaseUrl', 'apiKey', 'autocompleteBbox']);
			
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
			$.each (supportedPlaceholders, function (index, field) {
				placeholder = '{%' + field + '}';
				string = string.replace(placeholder, _settings[field]);
			});
			
			// Return the modified string
			return string;
		},
		
		
		// Routing
		routing: function ()
		{
			// Attach the route planning UI either to the Card UI (for mobile) or to the bottom-right of the map (for desktop)
			if (_isMobileDevice) {
				$('#cardcontent').append ('<div id="routeplanning"></div>');
			} else {
				var control = journeyplanner.createControl ('routeplanning', 'bottom-right');
			}
			
			// Delegate to separate class
			routing.initialise (_settings, _map, _isMobileDevice, _panningEnabled, true);
		}
	};
	
} (jQuery));

