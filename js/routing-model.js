var routingModel = {

    // Helper function to implement settings placeholder substitution in a string
    settingsPlaceholderSubstitution(string, supportedPlaceholders) {
        // Substitute each placeholder
        let placeholder;
        supportedPlaceholders.forEach((field, index) => {
            placeholder = '{%' + field + '}';
            //string = string.replace(placeholder, _settings[field]);
            string = string.replace(placeholder, 'sad');
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
        _urlParameters = urlParameters;
    }
}