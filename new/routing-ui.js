// Route planning / satnav user interface

/*jslint browser: true, white: true, single: true, for: true, long: true, unordered: true */
/*global alert, console, window, confirm, prompt, mapboxgl, autocomplete, Sortable */

const routing = (function () {
	
	'use strict';
	
	
	// Settings defaults
	const _settings = {
		apiBaseUrl: 'https://api.cyclestreets.net',
		apiKey: null,
		plannerDivPath: '#routeplanning',
		resultsContainerDivPath: '#resultstabspanel',
		initialRoute: [],	// E.g. [[0.123902, 52.202968], [-0.127669, 51.507318]], as array of lon,lat pairs
		
		// Zoom levels
		maxZoom: 17,
		minSetMarkerZoom: 13,
		panDuration: 1500,	// ms
		
		// Geocoding API URL; re-use of settings values represented as placeholders {%apiBaseUrl}, {%apiKey}, {%autocompleteBbox}, are supported
		geocoderApiUrl:        '{%apiBaseUrl}/v2/geocoder?key={%apiKey}&bounded=1&bbox={%autocompleteBbox}',
		reverseGeocoderApiUrl: '{%apiBaseUrl}/v2/nearestpoint?key={%apiKey}',
		
		// BBOX for autocomplete results biasing
		autocompleteBbox: '-6.6577,49.9370,1.7797,57.6924'
	};
	
	// Properties
	let _map;
	let _markers = [];
	let _geocoders = [];
	let _geocoderHtml = '';
	let _geocoderFocus = 0;
	
	// Waypoints state; this is a list of objects containing uuid, locationString, lon, lat
	const _requiredWaypoints = 2;
	const _waypoints = [];
	
	
	
	return {
		
		// Main entry point
		initialise: function (config, map)
		{
			// Merge the configuration into the settings
			for (const [setting, value] of Object.entries (_settings)) {
				if (config.hasOwnProperty (setting)) {
					_settings[setting] = config[setting];
				}
			}
			
			// Set initial route, if supplied; a null point will create the slot but with no value, which is useful for a preset destination
			_settings.initialRoute.forEach (function (initialPoint, waypointIndex) {
				if (initialPoint == null) {
					routing.emptyWaypoint (waypointIndex);
				} else {
					routing.setWaypoint ({lng: initialPoint[0], lat: initialPoint[1]}, waypointIndex);
				}
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
		
		
		// Function to create and manage route retrieval and display
		router: function ()
		{
			document.addEventListener ('@waypoints/update', function () {
				document.querySelector (_settings.resultsContainerDivPath + ' #waypointsdebug').innerText = JSON.stringify (_waypoints).replaceAll ('},{"uuid"', "},\n\n" + '{"uuid"').replaceAll (',"', ',' + "\n" + '"');
			});
		},
		
		
		// Function to create and manage geocoder controls
		geocoders: function ()
		{
			// Get the HTML for a geocoder, from the static HTML, to enable cloning
			_geocoderHtml = document.querySelector ('#geocoders li:first-child');
			
			// When waypoints updated, redraw
			document.addEventListener ('@waypoints/update', function () {
				
				// Remove all existing geocoders, both their handlers and then their HTML
				for (let i = 0; i < _geocoders.length; i++) {
					routing.removeGeocoderHandler (i);
				}
				_geocoders = [];
				document.getElementById ('geocoders').innerHTML = '';
				
				// Initially, create as many geocoders as waypoints, but always the minimum number
				const totalWaypoints = Math.max (_waypoints.length, _requiredWaypoints);
				
				// Create each geocoder
				for (let j = 0; j < totalWaypoints; j++) {
					routing.createGeocoder (j);
				}
				
				// Set focus/selection
				const nextGeocoder = '#geocoders li:nth-child(' + (_geocoderFocus + 1) + ') input';	// nth-child uses 1-indexing
				if (document.querySelector (nextGeocoder)) {
					document.querySelector (nextGeocoder).select ();
				}
			});
			
			// Handle X clearance link buttons; these are done as a single late-bound event, either removing the waypoint or, if that would leave too few, clearing it
			document.querySelector ('#geocoders').addEventListener ('click', function (event) {
				if (event.target.tagName.toLowerCase () == 'a' && event.target.href.split ('#')[1] == 'clear') {
					const waypointIndex = event.target.parentElement.dataset.waypoint;
					if (_waypoints.length > _requiredWaypoints) {
						routing.removeWaypoint (waypointIndex);
					} else {
						routing.emptyWaypoint (waypointIndex);
					}
					event.preventDefault ();	// Avoid #clear in URL
				}
			});
			
			// Make geocoders draggable; see: https://github.com/SortableJS/Sortable
			new Sortable (document.getElementById ('geocoders'), {
				handle: '.handle',
				onEnd: function (event) {
					routing.swapWaypoints (event.oldIndex, event.newIndex);
				}
			});
		},
		
		
		// Function to create a single geocoder and handle the result
		// See: https://github.com/kraaden/autocomplete#readme
		createGeocoder: function (waypointIndex)
		{
			// Create the HTML
			const newLi = _geocoderHtml.cloneNode (true);
			newLi.dataset.waypoint = waypointIndex;
			document.querySelector('#geocoders').appendChild (newLi);
			
			// Locate the input
			const input = document.querySelector ('#geocoders li:nth-child(' + (waypointIndex + 1) + ') input');
			
			// Set colour for this geocoder's X button
			document.querySelector ('#geocoders li:nth-child(' + (waypointIndex + 1) + ') a').style.color = routing.waypointColour (waypointIndex, true);
			
			// Pre-fill text value
			if (_waypoints[waypointIndex] != null) {
				input.value = _waypoints[waypointIndex].locationString;
			}
			
			// Attach autocomplete behaviour to the input
			_geocoders[waypointIndex] = autocomplete ({
				input: input,
				minLength: 3,
				debounceWaitMs: 300,
				disableAutoSelect: true,
				render: function (item, currentValue) {
					const feature = item.value;
					const div = document.createElement ('div');
					div.innerHTML = feature.properties.name + '<br />' + '<span class="near">' + feature.properties.near + '</span>';
					return div;
				},
				fetch: function (text, update) {
					
					// Show loading indicator
					input.style.backgroundImage = "url('loading.svg')";
					
					// Assemble Geocoder URL
					let apiUrl = routing.settingsPlaceholderSubstitution (_settings.geocoderApiUrl, ['apiBaseUrl', 'apiKey', 'autocompleteBbox']);
					apiUrl += '&limit=12';
					apiUrl += '&countrycodes=gb,ie';
					apiUrl += '&q=' + text;

					// Retrieve geocoder results and show
					fetch (apiUrl)
						.then (function (response) { return response.json (); })
						.then (function (json) {
							input.style.backgroundImage = 'none';
							const suggestions = [];
							json.features.forEach (function (feature) {
								suggestions.push ({
									label: feature.properties.name + ', ' + feature.properties.near,
									value: feature
								});
							});
							update (suggestions);
						});
				},
				onSelect: function (item) {
					
					// Set focus to next, if present
					_geocoderFocus = waypointIndex + 1;
					
					// Set the visible value
					input.value = item.label;
					
					// Add the waypoint marker
					const feature = item.value;
					routing.setWaypoint ({
						lng: feature.geometry.coordinates[0],
						lat: feature.geometry.coordinates[1],
						locationString: item.label,
						resolved: false
					}, waypointIndex);
				}
			});
		},
		
		
		// Function to remove a geocoder's handler
		// See: https://github.com/kraaden/autocomplete#unload-autocomplete
		removeGeocoderHandler: function (waypointIndex)
		{
			// Destroy the handler
			_geocoders[waypointIndex].destroy ();
			
			// Destroy the registry entry
			delete _geocoders[waypointIndex];
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
			
			// Handle waypoint addition, setting a click on the map to add to the end of the list (or first empty entry), ensuring sufficient zoom to set a marker accurately
			_map.on ('click', function (event) {
				const currentZoom = _map.getZoom ();
				if (currentZoom < _settings.minSetMarkerZoom) {
					const newZoom = Math.min ((currentZoom + 3), _settings.maxZoom);
					_map.flyTo ({center: event.lngLat, zoom: newZoom, duration: _settings.panDuration});
				} else {
					routing.setWaypoint (event.lngLat);
				}
			});
			
			// Handle waypoint removal
			document.querySelector ('#map').addEventListener ('click', function (event) {	// Late binding, as waypoints/popups may not yet exist
				if (event.target.className == 'removewaypoint') {
					const waypointIndex = routing.findWaypointByUuid (event.target.dataset.uuid);
					routing.removeWaypoint (waypointIndex);
				}
			})
		},
		
		
		// Function to set a waypoint location
		setWaypoint: function (location, updateIndex)
		{
			// If adding, first check if there are any empty waypoint slots, and if so, allocate the first such slot
			if (updateIndex == null) {
				const firstEmpty = _waypoints.findIndex (function (waypoint) { return (waypoint == null); });
				if (firstEmpty >= 0) {
					updateIndex = firstEmpty;
				}
			}
			
			// Set clicked location initially, subject to later resolution by nearest point below
			const waypoint = {
				uuid: (updateIndex == null || _waypoints[updateIndex] == null ? routing.uuidv4 () : _waypoints[updateIndex].uuid),
				locationString: (location.hasOwnProperty ('locationString') ? location.locationString : 'Waypoint'),
				lon: location.lng.toFixed (5),
				lat: location.lat.toFixed (5),
				resolved: location.resolved
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
			if (!waypoint.resolved) {	// May be known to be resolved already
				routing.resolveNearestpoint (waypoint);
			}
		},
		
		
		// Function to resolve nearest point for a waypoint, asyncronously
		resolveNearestpoint: function (waypoint)
		{
			// Look up the name and nearest point for this location from the geocoder, asyncronously, and attach it to the waypoints registry
			let apiUrl = routing.settingsPlaceholderSubstitution (_settings.reverseGeocoderApiUrl, ['apiBaseUrl', 'apiKey']);
			apiUrl += '&lonlat=' + waypoint.lon + ',' + waypoint.lat;
			fetch (apiUrl)
				.then (function (response) { return response.json (); })
				.then (function (json) {
					
					// Find the feature to update
					const waypointIndex = routing.findWaypointByUuid (waypoint.uuid);
					
					// If an error message is returned, e.g. due to a location in the sea, remove it
					if (json.error) {
						alert (json.error);
						routing.removeWaypoint (waypointIndex);
						return;
					}
					
					// Update the feature
					const feature = json.features[0];
					routing.updateWaypoint ({
						lng: feature.geometry.coordinates[0],
						lat: feature.geometry.coordinates[1],
						locationString: feature.properties.name,
						resolved: true
					}, waypointIndex);
				});
		},
		
		
		// Function to get the index of a waypoint by UUID
		findWaypointByUuid (uuid)
		{
			// Compare by UUID, and return the index
			return _waypoints.findIndex (function (thisWaypoint) {
				return (thisWaypoint != null && thisWaypoint.uuid == uuid)
			});
		},
		
		
		// Function to update a waypoint location
		updateWaypoint: function (location, waypointIndex)
		{
			// Set the values
			_waypoints[waypointIndex].locationString = location.locationString;
			_waypoints[waypointIndex].lon = location.lng.toFixed (5);
			_waypoints[waypointIndex].lat = location.lat.toFixed (5);
			_waypoints[waypointIndex].resolved = location.resolved;
			
			// Dispatch event that waypoints updated
			document.dispatchEvent (new Event ('@waypoints/update', {bubbles: true}));
		},
		
		
		// Function to remove a waypoint location
		removeWaypoint: function (waypointIndex)
		{
			// Remove this entry and reindex
			_waypoints.splice (waypointIndex, 1);
			
			// Dispatch event that waypoints updated
			document.dispatchEvent (new Event ('@waypoints/update', {bubbles: true}));
		},
		
		
		// Function to clear a waypoint (or set it as explicitly empty), leaving it unfilled
		emptyWaypoint: function (waypointIndex)
		{
			// Clear the entry but retain indexing for all other waypoints
			_waypoints[waypointIndex] = null;
			
			// Dispatch event that waypoints updated
			document.dispatchEvent (new Event ('@waypoints/update', {bubbles: true}));
		},
		
		
		// Function to swap waypoints
		swapWaypoints: function (a, b)
		{
			// Swap; see: https://stackoverflow.com/a/872317/
			[_waypoints[a], _waypoints[b]] = [_waypoints[b], _waypoints[a]];
			
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
				
				// Skip drawing if an empty waypoint
				if (waypoint == null) {return;}	// I.e. continue
				
				// Create the marker
				_markers[index] = new mapboxgl.Marker ({draggable: true, color: routing.waypointColour (index, waypoint.resolved)})
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
			
			// Pan map to contain all waypoints, if any
			if (routing.nonEmptyWaypoints ()) {
				_map.fitBounds (routing.waypointsBounds (), {duration: _settings.panDuration, maxZoom: _settings.maxZoom, padding: 50});
			}
		},
		
		
		// Function to count non-empty waypoints
		nonEmptyWaypoints: function ()
		{
			return _waypoints.filter ( function (waypoint) {return (waypoint != null);} ).length;
		},
		
		
		// Set marker colour
		waypointColour: function (index, resolved)
		{
			// If not yet resolved by nearestpoint, return gray
			if (!resolved) {
				return 'gray';
			}
			
			// Set colour
			switch (index) {
				case 0:
					return 'green';
				case (_waypoints.length - 1):
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
		
		
		// Function to determine the bounds for all waypoints
		// See: https://docs.mapbox.com/mapbox-gl-js/example/zoomto-linestring/
		waypointsBounds: function ()
		{
			// Create a LngLatBounds object with both corners at the first coordinate, then extend to include each coordinate; coordinates use the lng/lat fields
			const bounds = new mapboxgl.LngLatBounds (_waypoints[0], _waypoints[0]);
			for (const waypoint of _waypoints) {
				bounds.extend (waypoint);
			}
			
			// Return the result
			return bounds;
		},
		
		
		// Helper function to implement settings placeholder substitution in a string
		settingsPlaceholderSubstitution: function (string, supportedPlaceholders)
		{
			// Substitute each placeholder
			let placeholder;
			supportedPlaceholders.forEach (function (field) {
				placeholder = '{%' + field + '}';
				string = string.replace (placeholder, _settings[field]);
			});
			
			// Return the modified string
			return string;
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
} ());
