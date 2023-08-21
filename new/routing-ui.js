// Route planning / satnav user interface

/*jslint browser: true, white: true, single: true, for: true, long: true, unordered: true */
/*global alert, console, window, confirm, prompt, mapboxgl */

var routing = (function ($) {
	
	'use strict';
	
	
	// Settings defaults
	const _settings = {
		apiBaseUrl: 'https://api.cyclestreets.net',
		apiKey: null,
		plannerDivPath: '#routeplanning',
		resultsContainerDivPath: '#resultstabspanel',
		initialRoute: [],	// E.g. [[0.123902, 52.202968], [-0.127669, 51.507318]], as array of lon,lat pairs
	};
	
	// Properties
	let _map;
	let _markers = [];
	
	// Waypoints state; this is a list of objects containing uuid, locationString, lon, lat
	const _waypoints = [];
	
	
	
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
			
			// Set initial route, if supplied
			_settings.initialRoute.forEach (function (initialPoint) {
				routing.setWaypoint ({lng: initialPoint[0], lat: initialPoint[1]});
			});
			
			// Create handles
			_map = map;
			
			// Create and manage route retrieval and display
			routing.router ();
			
			// Create and manage geocoders
			routing.geocoders ();
			
			// Create and manage waypoint markers
			routing.markers ();
		},
		
		
		// Function to create and manage geocoders
		geocoders: function ()
		{
		},
		
		
		// Function to create and manage waypoint markers
		markers: function ()
		{
			// When waypoints updated, redraw
			document.addEventListener ('@waypoints/update', function () {
				routing.drawMarkers ();
			});
			
			// Draw any initial markers
			if (_waypoints.length) {
				document.dispatchEvent (new Event ('@waypoints/update', {bubbles: true}));
			}
			
			// Handle waypoint addition, setting a click on the map to add to the end of the list
			_map.on ('click', function (event) {
				routing.setWaypoint (event.lngLat);
			});
			
			// Handle waypoint removal
			document.querySelector ('#map').addEventListener ('click', function (event) {	// Late binding, as waypoints/popups may not yet exist
				if (event.target.className == 'removewaypoint') {
					routing.removeWaypoint (event.target.dataset.uuid);
				}
			})
		},
		
		
		// Function to set a waypoint location
		setWaypoint: function (lngLat, updateIndex)
		{
			// Set clicked location initially, subject to later resolution by nearest point below
			const waypoint = {
				uuid: (updateIndex == null ? routing.uuidv4 () : _waypoints[updateIndex].uuid),
				locationString: 'Waypoint',
				lon: lngLat.lng.toFixed (5),
				lat: lngLat.lat.toFixed (5)
			};
			
			// Add the waypoint, either addition or replace
			if (updateIndex == null) {	// NB Could be zero, i.e. first waypoint
				_waypoints.push (waypoint);
			} else {
				_waypoints[updateIndex] = waypoint;
			}
			
			// Dispatch event that waypoints updated
			document.dispatchEvent (new Event ('@waypoints/update', {bubbles: true}));
			
			// Resolve waypoint to nearest point, asyncronously
			routing.resolveNearestpoint (waypoint);
		},
		
		
		// Function to resolve nearest point for a waypoint, asyncronously
		resolveNearestpoint: function (waypoint)
		{
			// Look up the name and nearest point for this location from the geocoder, asyncronously, and attach it to the waypoints registry
			const apiUrl = _settings.apiBaseUrl + '/v2/nearestpoint?key=' + _settings.apiKey + '&lonlat=' + waypoint.lon + ',' + waypoint.lat;
			fetch (apiUrl)
				.then (function (response) { return response.json (); })
				.then (function (json) {
					
					// Find the feature to update
					const waypointIndex = routing.findWaypointByUuid (waypoint.uuid);
					
					// Update the feature
					const feature = json.features[0];
					_waypoints[waypointIndex].locationString = feature.properties.name;
					_waypoints[waypointIndex].lon = feature.geometry.coordinates[0];
					_waypoints[waypointIndex].lat = feature.geometry.coordinates[1];
					
					// Dispatch event that waypoints updated
					document.dispatchEvent (new Event ('@waypoints/update', {bubbles: true}));
				});
		},
		
		
		// Function to get the index of a waypoint by UUID
		findWaypointByUuid (uuid)
		{
			// Compare by UUID, and return the index
			return _waypoints.findIndex (function (thisWaypoint) {
				return (thisWaypoint.uuid == uuid)
			});
		},
		
		
		// Function to remove a waypoint location
		removeWaypoint: function (uuid)
		{
			// Find the index
			const waypointIndex = routing.findWaypointByUuid (uuid);
			
			// Remove this entry and reindex
			_waypoints.splice (waypointIndex, 1);
			
			// Dispatch event that waypoints updated
			document.dispatchEvent (new Event ('@waypoints/update', {bubbles: true}));
		},
		
		
		// Function to draw markers
		drawMarkers: function ()
		{
			// Remove any existing markers
			_markers.forEach (function (marker) {
				marker.remove ();
			});
			_markers = [];
			
			// Draw each waypoint
			_waypoints.forEach (function (waypoint, index) {
				
				// Create the marker
				_markers[index] = new mapboxgl.Marker ({draggable: true, color: routing.markerColour (index, _waypoints.length)})
					.setLngLat ([waypoint.lon, waypoint.lat])
					.setPopup (new mapboxgl.Popup ({closeOnClick: true}).setHTML ('<p>' + routing.htmlspecialchars (waypoint.locationString) + "</p>\n" + '<p><a href="#" class="removewaypoint" data-uuid="' + waypoint.uuid + '">Remove?</a></p>'))
					.addTo (_map);
				
				// Stop propagation of marker click, by handling popups manually; see: https://github.com/mapbox/mapbox-gl-js/issues/1209#issuecomment-995554174
				_markers[index].getElement ().addEventListener ('click', function (event) {
					routing.closeAllPopups ();
					_markers[index].togglePopup ();
					event.stopPropagation ();
				}, false);
				
				// Handle waypoint drag
				_markers[index].on ('dragend', function () {
					routing.setWaypoint (_markers[index].getLngLat (), index);
				});
			});
		},
		
		
		// Set marker colour
		markerColour: function (index, totalWaypoints)
		{
			// Set colour
			switch (index) {
				case 0:
					return 'green';
				case (totalWaypoints - 1):
					return 'red';
				default:
					return 'orange';
			}
		},
		
		
		// Function to remove all existing popups; see: https://stackoverflow.com/a/63006609/180733
		closeAllPopups: function ()
		{
			const popups = document.getElementsByClassName ('mapboxgl-popup');
			for (let popup of popups) {
				popup.remove ();
			};
		},
		
		
		// Function to create and manage route retrieval and display
		router: function ()
		{
			document.addEventListener ('@waypoints/update', function () {
				document.querySelector (_settings.resultsContainerDivPath).innerText = JSON.stringify (_waypoints).replaceAll ('},{"uuid"', "},\n\n" + '{"uuid"').replaceAll (',"', ',' + "\n" + '"');
			});
		},
		
		
		// Function to make data entity-safe
		htmlspecialchars: function (string)
		{
			if (typeof string !== 'string') {return string;}
			return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		},
		
		
		// UUID generation; see: https://stackoverflow.com/a/2117523/180733
		uuidv4: function ()
		{
			if (typeof crypto.randomUUID === 'function') {
				return crypto.randomUUID ();
			}
			
			return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace (/[018]/g, c =>
				(c ^ crypto.getRandomValues (new Uint8Array (1))[0] & 15 >> c / 4).toString (16)
			);
		}

	};
	
} (jQuery));


