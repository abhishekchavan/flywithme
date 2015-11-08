/**
 * Api services are defined here.
 */
'use strict';


var express = require('express');
var router = express.Router();
var cloudant;
var _ = require('underscore');

var db;
var dbCredentials = {
    dbName: 'my_sample_db'
};

var request = require('request');
var JSONPath = require('JSONPath');
var cfenv = require('cfenv');
var async = require('async');
var appEnv = cfenv.getAppEnv();
var config = {
    'twitter': {
        'consumer_key': 'bdy6byYES9x0UquBvn1nrw',
        'consumer_secret': 'T4RdK14BgoPTjICPNSVyXgEEnKaW6qfDkgqo4xddLU',
        'access_token_key': '538764469-mjbY0LOSGJaIGp1gJ5YsMcgy3F3ptgcFHRRZdtmN',
        'access_token_secret': 'oLupXZ3EfG8zcNDKlcIYOdJ9URP88YSnhARCZxoIj0'
    }
};
//?FlightDate=12-NOV-2015&Origin=SFO&Destination=DXB&Class=FIRST
const FLIGHT_AVAILABILITY_URL = 'https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/flightavailability/1.0/';

//FlightNo=EK452&FlightDate=12-Nov-2015&Origin=SFO&Destination=DXB
const ON_BOARD_SERVICES_URL = 'https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/onboardservices/1.0/';

//?FlightNumber=EK452&DepartureDate=12-NOV-2015
const IN_FLIGHT_FEATURES = 'https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/inflightfeatures/1.0/';


const ATTRACTIONS_URL = 'https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/attractions/1.0/';

const TOUR_PACKAGES_URL = 'https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/tourpackages/1.0/';

var watson = require('watson-developer-cloud');

var personality_insights = watson.personality_insights({
    username: appEnv.personality_insights ? appEnv.personality_insights.credentials.username : '4277145b-dbfe-4305-868b-19ac0f48fa60',
    password: appEnv.personality_insights ? appEnv.personality_insights.credentials.password : 'AzDBkBj425Sf',
    version: 'v2'
});

var Twitter = require('twitter');

var twitterClient = new Twitter({
    consumer_key: config.twitter.consumer_key,
    consumer_secret: config.twitter.consumer_secret,
    access_token_key: config.twitter.access_token_key,
    access_token_secret: config.twitter.access_token_secret
});

function PersonalityTraits(obj) {
    this.showAttractions = false;
    this.seatSelection = false;
    this.transfers = false;
    this.priceCare = false;
    this.loveIndex = false;
    this.stability = false;
}


function processInsightsData(insightsResponse) {

    var personalityTraits = new PersonalityTraits();

    let mapT = new Map();


    _.each(insightsResponse.tree.children, function(element) {
        var key = element.id; // Personality
        var mapInsideMap = new Map();

        _.each(element.children, function(insideElement) {
            if (key === 'personality') {
                _.each(insideElement.children, function(anotherInside) {
                    _.each(anotherInside.children, function(actualElement) {
                        mapInsideMap.set(actualElement.id, actualElement.percentage);
                    });
                });
            } else {
                _.each(insideElement.children, function(anotherInside) {
                    mapInsideMap.set(anotherInside.id, anotherInside.percentage);
                });
            }
        });
        mapT.set(key, mapInsideMap);
    });
    if (mapT.get('personality').get('Adventurousness') > 0.85 || mapT.get('personality').get('Excitement-seeking') > 0.5) {
        personalityTraits.showAttractions = true;
    }
    if (mapT.get('personality').get('Cautiousness') > 0.50) {
        personalityTraits.seatSelection = true;
    }

    if (mapT.get('personality').get('Excitement-seeking') > 0.50) {
        personalityTraits.transfers = true;
    }

    if (mapT.get('personality').get('Intellect') > 0.50) {
        personalityTraits.priceCare = true;
    }
    if (mapT.get('needs').get('Love') > 0.30) {
        personalityTraits.loveIndex = true;
    }

    if (mapT.get('needs').get('Stability') > 0.30) {
        personalityTraits.stability = true;
    }
    console.log(mapT);

    return personalityTraits;
}

function initDBConnection() {

    if (process.env.VCAP_SERVICES) {
        var vcapServices = JSON.parse(process.env.VCAP_SERVICES);
        if (vcapServices.cloudantNoSQLDB) {
            dbCredentials.host = vcapServices.cloudantNoSQLDB[0].credentials.host;
            dbCredentials.port = vcapServices.cloudantNoSQLDB[0].credentials.port;
            dbCredentials.user = vcapServices.cloudantNoSQLDB[0].credentials.username;
            dbCredentials.password = vcapServices.cloudantNoSQLDB[0].credentials.password;
            dbCredentials.url = vcapServices.cloudantNoSQLDB[0].credentials.url;

            cloudant = require('cloudant')(dbCredentials.url);

            // check if DB exists if not create
            cloudant.db.create(dbCredentials.dbName, function(err, res) {
                if (err) {
                    console.log('could not create db ', err);
                }
            });

            db = cloudant.use(dbCredentials.dbName);

        } else {
            console.warn('Could not find Cloudant credentials in VCAP_SERVICES environment variable - data will be unavailable to the UI');
        }
    } else {
        console.warn('VCAP_SERVICES environment variable not set - data will be unavailable to the UI');
        // For running this app locally you can get your Cloudant credentials 
        // from Bluemix (VCAP_SERVICES in 'cf env' output or the Environment 
        // Variables section for an app in the Bluemix console dashboard).
        // Alternately you could point to a local database here instead of a 
        // Bluemix service.
        //dbCredentials.host = 'REPLACE ME';
        //dbCredentials.port = REPLACE ME;
        //dbCredentials.user = 'REPLACE ME';
        //dbCredentials.password = 'REPLACE ME';
        //dbCredentials.url = 'REPLACE ME';
    }
}

initDBConnection();



// define the home page route
router.get('/twitter/:userId', function(req, res) {
    var twitterUser = req.params.userId;
    var params = {
        'screen_name': twitterUser,
        'count': 200
    };
    twitterClient.get('statuses/user_timeline', params, function(error, tweets) {
        if (!error) {
            console.log(tweets);
            var textTweets = [];
            _.each(tweets, function(tweet) {
                textTweets.push(tweet.text);
            });

            personality_insights.profile({
                    text: textTweets,
                    language: 'en'
                },
                function(err, response) {
                    if (err) {
                        console.log('error:', err);
                    } else {
                        console.log(response);
                        let personalityTraits = processInsightsData(response);
                        res.json(personalityTraits);
                    }
                });
        }
    });
});

router.get('/flightAvailability', function(req, res, next) {
    // Check for flights.
    let qs = {
        FlightDate: req.query.flightDate,
        Origin: req.query.origin,
        Destination: req.query.destination,
        Class: req.query.class
    };
    request.get({
        url: FLIGHT_AVAILABILITY_URL,
        qs: qs,
        json: true,
        headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer 7c4e4ae88ef57f6183fc8b33858decb4'
        },
        rejectUnauthorized: false
    }, function(err, response, flightAvailability) {
        console.log(flightAvailability);
        var trustResponse = [];
        async.each(flightAvailability.FlightAvailabilityList, function(element, callback) {
            request.get({
                url: ON_BOARD_SERVICES_URL,
                qs: {
                    FlightNo: element.FlightNo,
                    FlightDate: req.query.flightDate,
                    Origin: req.query.origin,
                    Destination: req.query.destination
                },
                json: true,
                headers: {
                    'Accept': 'application/json',
                    'Authorization': 'Bearer 7c4e4ae88ef57f6183fc8b33858decb4'
                },
                rejectUnauthorized: false
            }, function(err, response, onBoardServices) {
                console.log(element);
                if (!err) {
                    element.Entertainment = onBoardServices.Entertainment;
                    element.InflightCommunications = onBoardServices.InflightCommunications;
                    element.Dining = onBoardServices.Dining;
                    element.Wines = onBoardServices.Wines;
                } else {
                    console.log(err);
                }
                trustResponse.push(element);
                callback(null);
            });
        }, function(errSas) {
            res.json(trustResponse);
        });

    });
});

router.get('/adventurePacks', function(req, res, next) {
    //https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/tourpackages/1.0/?CityName=AS
    request.get({
        url: TOUR_PACKAGES_URL,
        qs: {
            CityName: req.query.city
        },
        json: true,
        headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer 7c4e4ae88ef57f6183fc8b33858decb4'
        },
        rejectUnauthorized: false
    }, function(err, response, tourDetails) {
        res.send(tourDetails);
    });
});

router.get('/attractions', function(req, res, next) {
    //https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/tourpackages/1.0/?CityName=AS
    request.get({
        url: 'https://ec2-54-77-6-21.eu-west-1.compute.amazonaws.com:8143/attractions/1.0/',
        qs: {
            CityName: req.query.city
        },
        json: true,
        headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer 7c4e4ae88ef57f6183fc8b33858decb4'
        },
        rejectUnauthorized: false
    }, function(err, response, tourDetails) {
        console.log(tourDetails);
        res.send(tourDetails.Attraction);
    });
});

// define the home page route
router.get('/twitterData/:userId', function(req, res) {
    var twitterUser = req.params.userId;
    var params = {
        'screen_name': twitterUser,
        'count': 200
    };
    twitterClient.get('statuses/user_timeline', params, function(error, tweets) {
        if (!error) {
            console.log(tweets);
            var textTweets = [];
            _.each(tweets, function(tweet) {
                textTweets.push(tweet.text);
            });

            personality_insights.profile({
                    text: textTweets,
                    language: 'en'
                },
                function(err, response) {
                    if (err) {
                        console.log('error:', err);
                    } else {
                        console.log(response.tree);
                        res.json(response.tree);
                    }
                });
        }
    });
});



module.exports = router;
