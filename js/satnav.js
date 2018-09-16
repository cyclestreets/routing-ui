// CycleStreets HTML5 satnav in a browser

/*jslint browser: true, white: true, single: true, for: true */
/*global $, alert, console, window, FULLTILT */

var satnav = (function ($) {
	
	'use strict';
	
	
	// Internal class properties
	var _map = null;
	
	
	return {
		
		// Main entry point
		initialise: function ()
		{
			// Create the map
			satnav.createMap ();
			
			// Enable tilt and direction
			satnav.enableTilt ();
		},
		
		
		// Create map; see: https://www.mapbox.com/mapbox-gl-js/example/simple-map/
		createMap: function ()
		{
			mapboxgl.accessToken = '<your access token here>';
			var map = new mapboxgl.Map ({
			_map = new mapboxgl.Map ({
				container: 'map',
				style: 'mapbox://styles/mapbox/streets-v9',
				center: [0.12, 52.2],
				zoom: 14
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
		}
	};
	
} (jQuery));

