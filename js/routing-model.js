
// Settings defaults
var _settings = {

    // Title
    title: 'CycleStreets',

    // CycleStreets API
    apiBaseUrl: 'https://api.cyclestreets.net',
    apiKey: 'YOUR_CYCLESTREETS_API_KEY',

    // Target UI <div> paths, defined by the client code, which the library will populate
    plannerDivPath: '#routeplanning',
    mapStyleDivPath: '#layerswitcher',

    // Max zoom
    maxZoom: 17,
    maxZoomToSegment: 17,

    // Below this zoom level a mouse click zooms-in the map
    minimumZoomForStreetSelection: 13,

    // Geocoder API URL; re-use of settings values represented as placeholders {%apiBaseUrl}, {%apiKey}, {%autocompleteBbox}, are supported
    geocoderApiUrl: '{%apiBaseUrl}/v2/geocoder?key={%apiKey}&bounded=1&bbox={%autocompleteBbox}',
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
    multiplexedStrategies: true,
    strategies: [
        {
            id: 'fastest',
            label: 'Fastest route',
            parameters: { plans: 'fastest' },
            lineColour: '#cc0000',
            lineColourOutline: 'red',
            attribution: 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
        },
        {
            id: 'balanced',
            label: 'Balanced route',
            parameters: { plans: 'balanced' },
            lineColour: '#ffc200',
            lineColourOutline: 'orange',
            attribution: 'Routing by <a href="https://www.cyclestreets.net/">CycleStreets</a>'
        },
        {
            id: 'quietest',
            label: 'Quietest route',
            parameters: { plans: 'quietest' },
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

    // Padding for fit bounds
    fitBoundsPadding: { top: 20, bottom: 20, left: 310, right: 380 },

    // Whether to show all route line results or just the currently-selected
    showAllRoutes: true,

    // Whether to plan routes the moment the map is clicked rather than wait until a routing button is pressed
    planRoutingOnMapClick: true,

    // Whether to show the basic Mapbox toolbox
    showToolBox: true,

    // Whether to prompt before clearing route
    promptBeforeClearingRoute: true,

    // Load Tabs class toggle, used when loading a parameterised URL. This CSS class will be added to the enabled parent li elements (i.e., 'checked', or 'selected')
    loadTabsClassToggle: 'enabled',

    // Element on which to display a routing "enabled" icon, while route is shown
    routingEnabledElement: null
};



var routingModel = {

    initialise(config) {
        // Merge the configuration into the settings
        Object.keys(_settings).forEach((setting, value) => {
            if (config.hasOwnProperty(setting)) {
                _settings[setting] = config[setting];
            }
        })
    },


    // Helper function to implement settings placeholder substitution in a string
    settingsPlaceholderSubstitution(string, supportedPlaceholders) {
        // Substitute each placeholder
        let placeholder;
        supportedPlaceholders.forEach((field, index) => {
            placeholder = '{%' + field + '}';
            //string = string.replace(placeholder, _settings[field]);
            string = string.replace(placeholder, _settings[field]);
        });

        // Return the modified string
        return string;
    },

    // Function to parse the URL
    parseUrl() {
        // Start a list of parameters
        var urlParameters = {};

        // Extract journey URL
        urlParameters.itineraryId = false;
        var matchesItinerary = window.location.pathname.match(/^\/journey\/([0-9]+)\/$/);
        if (matchesItinerary) {
            urlParameters.itineraryId = matchesItinerary[1];
        }

        // Extract journey URL
        urlParameters.waypoints = [];
        var matchesWaypoints = window.location.pathname.match(/^\/journey\/([-.0-9]+,[-.,\/0-9]+)\/$/);
        if (matchesWaypoints) {
            var waypointPairs = matchesWaypoints[1].split('/');
            var waypoints = [];
            var waypointLatLon;
            waypointPairs.forEach((waypointPair, index) => {
                var matches = waypointPair.match(/^([-.0-9]+),([-.0-9]+)$/);
                if (matches) {
                    waypointLatLon = waypointPair.split(',');
                    waypoints.push({ lng: waypointLatLon[1], lat: waypointLatLon[0], label: null });
                }
            })

            if (waypoints.length >= 2) {
                urlParameters.waypoints = waypoints;
            }
        }

        // Set the parameters
        return urlParameters;
    }
}