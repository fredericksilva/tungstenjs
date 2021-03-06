'use strict';

var _ = require('underscore');

var eventPairs = {
  'mouseenter': 'mouseleave',
  'mouseleave': 'mouseenter',
  'mousedown': 'mouseup',
  'mouseup': 'mousedown',
  'keydown': 'keyup',
  'keyup': 'keydown',
  'touchstart': 'touchend',
  'touchend': 'touchstart'
};

function getIntentHandler(method, options) {
  var lastEvent = null;
  var timeout = null;

  var opts = _.extend({
    intentDelay: 200
  }, options);

  var triggerIntent = function() {
    method(lastEvent);
  };

  var startIntent = function(evt) {
    lastEvent = evt;
    clearTimeout(timeout);
    timeout = setTimeout(triggerIntent, opts.intentDelay);
  };

  var stopIntent = function() {
    lastEvent = null;
    clearTimeout(timeout);
  };

  return {
    startIntent: startIntent,
    stopIntent: stopIntent
  };
}

module.exports = function(el, eventName, selector, method, options, bindVirtualEvent) {
  if (eventName.substr(-7) === '-intent') {
    var realEventName = eventName.substr(0, eventName.length - 7);
    // Only a subset of events are able to be reversed, so only those can be done with intent
    if (!eventPairs[realEventName]) {
      throw 'Unexpected intent event. ' + eventName + ' is not valid.';
    }

    var intent = getIntentHandler(method, options);
    return [
      bindVirtualEvent(el, realEventName, selector, intent.startIntent, options),
      bindVirtualEvent(document, eventPairs[realEventName], selector, intent.stopIntent, options)
    ];
  }
};