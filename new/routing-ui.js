var routing = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	const _settings = {
		
	};
	
	// Properties
	let _map;
	
	
	return {
		
		// Main entry point
		initialise: function (config, map)
		{
			// Merge the configuration into the settings
			$.each (_settings, function (setting, value) {
				if (config.hasOwnProperty (setting)) {
					_settings[setting] = config[setting];
				}
			});
			
			// Create handles
			_map = map;
			
			// Create and manage geocoders
			routing.geocoders ();
			
			// Create and manage waypoint markers
			routing.markers ();
			
			// Create and manage route retrieval and display
			routing.router ();
		},
		
		
		// Function to create and manage geocoders
		geocoders: function ()
		{
		},
		
		
		// Function to create and manage waypoint markers
		markers: function ()
		{
		},
		
		
		// Function to create and manage route retrieval and display
		router: function ()
		{
		},
		
		
		// Function to make data entity-safe
		htmlspecialchars: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
	};
	
} (jQuery));


