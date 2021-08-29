/*jshint esversion:6*/

$(function() {
    const video = $("video")[0];

    var model;
    var cameraMode = "environment"; // or "user"

    const startVideoStreamPromise = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            facingMode: cameraMode
        }
    }).then(function(stream) {
        return new Promise(function(resolve) {
            video.srcObject = stream;
            video.onloadeddata = function() {
                video.play();
                resolve();
            };
        });
    });

    var publishable_key = "rf_5w20VzQObTXjJhTjq6kad9ubrm33";
    var toLoad = {
        model: "playing-cards-ow27d",
        version: 1
    };

    const loadModelPromise = new Promise(function(resolve, reject) {
        roboflow.auth({
            publishable_key: publishable_key
        }).load(toLoad).then(function(m) {
            model = m;
            window.model = model;
            resolve();
        });
    });

    Promise.all([
        startVideoStreamPromise,
        loadModelPromise
    ]).then(function() {
        $('body').removeClass('loading');
        $('#dealerUpcard').show();
        resizeCanvas();
        detectFrame();
    });

    var canvas, ctx;
    const font = "16px sans-serif";

    function videoDimensions(video) {
        // Ratio of the video's intrisic dimensions
        var videoRatio = video.videoWidth / video.videoHeight;

        // The width and height of the video element
        var width = video.offsetWidth, height = video.offsetHeight;

        // The ratio of the element's width to its height
        var elementRatio = width/height;

        // If the video element is short and wide
        if(elementRatio > videoRatio) {
            width = height * videoRatio;
        } else {
            // It must be tall and thin, or exactly equal to the original ratio
            height = width / videoRatio;
        }

        return {
            width: width,
            height: height
        };
    }

    $(window).resize(function() {
        resizeCanvas();
    });

    const resizeCanvas = function() {
        $('canvas').remove();

        canvas = $('<canvas/>');

        ctx = canvas[0].getContext("2d");

        var dimensions = videoDimensions(video);

        // console.log(video.videoWidth, video.videoHeight, video.offsetWidth, video.offsetHeight, dimensions);

        canvas[0].width = video.videoWidth;
        canvas[0].height = video.videoHeight;

        canvas.css({
            width: dimensions.width,
            height: dimensions.height,
            left: ($(window).width() - dimensions.width) / 2,
            top: ($(window).height() - dimensions.height) / 2
        });

        $('body').append(canvas);
    };

    const renderPredictions = function(predictions) {
        // console.log(predictions);
        var dimensions = videoDimensions(video);

        var scale = 1;

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        predictions.forEach(function(prediction) {
            const x = prediction.bbox.x;
            const y = prediction.bbox.y;

            const width = prediction.bbox.width;
            const height = prediction.bbox.height;

            // Draw the bounding box.
            ctx.strokeStyle = prediction.color;
            ctx.lineWidth = 4;
            ctx.strokeRect((x-width/2)/scale, (y-height/2)/scale, width/scale, height/scale);

            // Draw the label background.
            ctx.fillStyle = prediction.color;
            const textWidth = ctx.measureText(prediction.class).width;
            const textHeight = parseInt(font, 10); // base 10
            ctx.fillRect((x-width/2)/scale, (y-height/2)/scale, textWidth + 8, textHeight + 4);
        });

        predictions.forEach(function(prediction) {
            const x = prediction.bbox.x;
            const y = prediction.bbox.y;

            const width = prediction.bbox.width;
            const height = prediction.bbox.height;

            // Draw the text last to ensure it's on top.bbox.
            ctx.font = font;
            ctx.textBaseline = "top";
            ctx.fillStyle = "#000000";
            ctx.fillText(prediction.class, (x-width/2)/scale+4, (y-height/2)/scale+1);
        });
    };

    var dealerUpcard = "A";
    $('#dealerUpcard button').click(function() {
        $('#dealerUpcard button').removeClass("selected");
        $(this).addClass("selected");
        dealerUpcard = $(this).attr("val");
        console.log("Set dealer upcard to", dealerUpcard);
    });

    var prevTime;
    var pastFrameTimes = [];
    const detectFrame = function() {
        if(!model) return requestAnimationFrame(detectFrame);

        model.detect(video).then(function(predictions) {
            var predictionsParsed = {};

            _.each(predictions, function(p) {
                if(!predictionsParsed[p.class]) {
                    predictionsParsed[p.class] = p;
                } else {
                    var existing = predictionsParsed[p.class];

                    var top = Math.min( (existing.bbox.y - existing.bbox.height/2), (p.bbox.y - p.bbox.height/2) );
                    var bottom = Math.max( (existing.bbox.y + existing.bbox.height/2), (p.bbox.y + p.bbox.height/2));
                    var left = Math.min( (existing.bbox.x - existing.bbox.width/2), (p.bbox.x - p.bbox.width/2) );
                    var right = Math.max( (existing.bbox.x + existing.bbox.width/2), (p.bbox.x + p.bbox.width/2));

                    existing.bbox.x = (left + right) / 2;
                    existing.bbox.y = (top + bottom) / 2;

                    existing.bbox.width = (right - left);
                    existing.bbox.height = (bottom - top);

                }
            });

            var cards = _.values(predictionsParsed);

            var soft = false;
            var isPair = cards.length == 2 && rankOf(cards[0].class) == rankOf(cards[1].class);
            var total = 0;
            var numberOfAces = 0;
            _.each(cards, function(card) {
                var value = getValueOfCard(card.class);
                total += value;

                soft = soft || isAnAce(card.class);
                if(isAnAce(card.class)) numberOfAces++;
            });
            var isBlackjack = (cards.length == 2) && (total == 21);
            var busted = total > 21;

            if(busted && soft) {
                while(numberOfAces > 0 && busted) {
                    total -= 10;
                    numberOfAces--;

                    busted = total > 21;
                }
                soft = numberOfAces > 0;
            }

            /*
            console.log("vars:", {
                soft: soft,
                isPair: isPair,
                total: total
            });
            */

            var action = determineAction(cards, dealerUpcard, total, soft, isPair, busted, isBlackjack);

            if(cards.length == 0) {
                $('#handValue').html("Find a Blackjack Hand");
            } else if(busted) {
                // console.log("Hand Value: Bust");
                $('#handValue').html("Bust (" + total + "). You lose.");
            } else if(isBlackjack) {
                // console.log("Hand Value: Blackjack!");
                $('#handValue').html("Blackjack, you win!");
            } else if(isPair) {
                // console.log("Hand Value: Pair of " + rankOf(cards[0].class) + "s");
                $('#handValue').html("Pair of " + pluralize(rankOf(cards[0].class)) + ", " + action);
            } else if(soft) {
                // console.log("Hand Value: Soft " + total);
                $('#handValue').html("Soft " + total + ", " + action);
            } else {
                // console.log("Hand Value: Hard " + total);
                $('#handValue').html("Hard " + total + ", " + action);
            }

            requestAnimationFrame(detectFrame);
            renderPredictions(cards);

            if(prevTime) {
                pastFrameTimes.push(Date.now() - prevTime);
                if(pastFrameTimes.length > 30) pastFrameTimes.shift();

                var totalFPS = 0;
                _.each(pastFrameTimes, function(t) {
                    totalFPS += t/1000;
                });

                var fps = pastFrameTimes.length / totalFPS;
                $('#fps').text(Math.round(fps));
            }
            prevTime = Date.now();
        }).catch(function(e) {
            // console.log("CAUGHT", e);
            requestAnimationFrame(detectFrame);
        });
    };
});

function suitless(cls) {
    return cls.substring(0, cls.length-1);
}

function rankOf(cls) {
    switch(suitless(cls)) {
        case "2": return "Two";
        case "3": return "Three";
        case "4": return "Four";
        case "5": return "Five";
        case "6": return "Six";
        case "7": return "Seven";
        case "8": return "Eight";
        case "9": return "Nine";
        case "10": return "Ten";
        case "J": return "Jack";
        case "Q": return "Queen";
        case "K": return "King";
        case "A": return "Ace";
    }
}

function pluralize(cls) {
    if(cls == "Six") return "Sixes";
    return cls + "s";
}

function getValueOfCard(cls) {
    switch(suitless(cls)) {
        case "2": return 2;
        case "3": return 3;
        case "4": return 4;
        case "5": return 5;
        case "6": return 6;
        case "7": return 7;
        case "8": return 8;
        case "9": return 9;
        case "10":
        case "J":
        case "Q":
        case "K":
            return 10;
        case "A": return 11;
    }
}

function isAnAce(cls) {
    return suitless(cls) == "A";
}

function determineAction(cards, dealerUpcard, total, soft, isPair, busted, isBlackjack) {
    if(isBlackjack) return "You win.";
    if(busted) return "You lose.";

    if(cards.length == 2) {
        if(isPair) {
            // determine if we should split
            var pairOf = suitless(cards[0].class);
            if(pairOf == "8" || pairOf == "A") return "Split.";
            if(["2", "3", "6", "7", "9"].includes(pairOf) && getValueOfCard(dealerUpcard + "D") < 7) return "Split.";
        }

        // determine if we should double down
        if(soft) {
            if(total >= 13 && total <= 16 && (dealerUpcard == "5" || dealerUpcard == "6")) return "Double Down.";
            if((total == 17 || total == 18) && getValueOfCard(dealerUpcard + "D") < 7) return "Double Down.";
        } else {
            if(total == 9 && getValueOfCard(dealerUpcard + "D") < 7) return "Double Down.";
            if(total == 10 && getValueOfCard(dealerUpcard + "D") < 10) return "Double Down.";
            if(total == 11) return "Double Down.";
        }
    }

    // determine if we should hit or stay
    if(soft) {
        if(total < 18) return "Hit.";
        if(total > 18) return "Stay.";
        if(getValueOfCard(dealerUpcard + "D") < 8) return "Stay.";
        return "Hit.";
    } else {
        if(total < 12) return "Hit.";
        if(getValueOfCard(dealerUpcard + "D") < 7) {
            if(total == 12 && (dealerUpcard == "2" || dealerUpcard == "3")) return "Hit.";
            return "Stay.";
        } else {
            if(total < 17) return "Hit.";
            return "Stay.";
        }
    }
}
