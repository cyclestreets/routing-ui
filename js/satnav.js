// CycleStreets HTML5 satnav in a browser

/*jslint browser: true, white: true, single: true, for: true */
/*global $, alert, console, window */

var satnav = (function ($) {
	
	'use strict';
	
	
	return {
		
		// Main entry point
		initialise: function ()
		{
			satnav.createMap ();
		},
		
		
		// Create map; see: https://www.mapbox.com/mapbox-gl-js/example/simple-map/
		createMap: function ()
		{
			mapboxgl.accessToken = '<your access token here>';
			var map = new mapboxgl.Map ({
				container: 'map',
				style: 'mapbox://styles/mapbox/streets-v9',
				center: [0.12, 52.2],
				zoom: 14
			});
		}
	};
	
} (jQuery));

