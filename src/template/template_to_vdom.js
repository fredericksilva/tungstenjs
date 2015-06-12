/**
 * Compiles Ractive format template objects into virtual-dom
 *
 * @author    Matt DeGennaro <mdegennaro@wayfair.com>
 */
'use strict';

var _ = require('underscore');
var tungsten = require('./../tungsten');
var Context = require('./template_context');
var logger = require('./../utils/logger');
var ractiveTypes = require('./ractive_types');
var FocusHook = require('./hooks/focus_hook');
var exports = {};

var HTMLCommentWidget = require('./widgets/html_comment');

// IE8 and back don't create whitespace-only nodes from the DOM
// This sets a flag so that templates don't create them either
var whitespaceOnlyRegex = /^\s*$/;
var supportsWhitespaceTextNodes = (function() {
  var d = document.createElement('div');
  d.innerHTML = ' ';
  return d.childNodes.length === 1;
})();

/**
 * Element to be used for various off-Document operations
 * @type {Element}
 */
var domFrag = document.createElement('div');

/**
 * Used to parse loose interpolators inside a opening tag
 * @param  {Object}  templates Template object
 * @param  {Context} context   current Context to evaluate in
 * @return {Object}            Parsed dictionary of attribute names/values
 */
function parseStringAttrs(templates, context) {
  var stringAttrs = '';
  for (var i = 0; i < templates.length; i++) {
    stringAttrs += ' ' + renderVdom(templates[i], context) + ' ';
  }
  domFrag.innerHTML = '<div ' + stringAttrs + '></div>';
  var childNodes = domFrag.childNodes;
  var elem;
  // Pull the div from the domFrag
  for (i = 0; i < childNodes.length; i++) {
    elem = childNodes[i];
    if (elem.nodeName.toUpperCase() === 'DIV') {
      break;
    }
  }

  // Iterate over attributes object for resultant values
  var result = {};
  var attrs = elem.attributes;
  for (i = 0; i < attrs.length; i++) {
    result[attrs[i].name] = attrs[i].value;
  }

  return result;
}

/**
 * Unescaped values often have HTML in them that needs to be parsed out
 * @param  {String}        value Value to check
 * @return {String|Object}       String if it contains no HTML or VTree otherwise
 */
function parseUnescapedString(value) {
  // Naive check to avoid parsing if value contains nothing HTML-ish or HTML-entity-ish
  if (value.indexOf('<') > -1 || value.indexOf('&') > -1) {
    domFrag.innerHTML = value;
    // @TODO investigate tokenizing
    value = tungsten.parseDOM(domFrag, true);
    // Top level text values need to be put back to Strings so we can combine text nodes
    for (var i = value.children.length; i--; ) {
      if (value.children[i] && value.children[i].type === 'VirtualText') {
        value.children[i] = value.children[i].text;
      }
    }
    return value.children;
  } else {
    return value;
  }
}

/**
 * Render the value of an element's attribute
 * @param  {String|Object} values  VTree object for the attribute value
 * @param  {Context}       context current Context to evaluate in
 * @return {String}                String value for the attribute
 */
function renderAttributeString(values, context) {
  if (typeof values === 'string') {
    return values;
  }

  var buffer = '';
  var value;
  for (var i = 0; i < values.length; i++) {
    value = renderVdom(values[i], context);
    if (typeof value === 'string') {
      buffer += value;
    } else if (Context.isArray(value)) {
      buffer += _.flatten(value).join('');
    }
  }

  return buffer;
}

/**
 * Map of attribute to property transforms
 * Templates use attribute name, but virtual-dom references properties first
 * @type {Object}
 */
var propertiesToTransform = {
  'class': 'className',
  'for': 'htmlFor'
};
/**
 * Returns property name to use or false if it should be treated as attribute
 * @param  {String}         attributeName Attribute to assign
 * @return {String|Boolean}              False if it should be an attribute, otherwise property name
 */
function transformPropertyName(attributeName) {
  if (propertiesToTransform[attributeName]) {
    return propertiesToTransform[attributeName];
  }
  // Data attributes are a special case..
  // Persisting them as attributes as they are often accessed via jQuery (i.e. data-click-location)
  // Use the nested attributes hash to avoid datasets because IE
  if (attributeName.substr(0, 5) === 'data-') {
    return false;
  }
  return attributeName;
}

/**
 * Recursive function to render Template into VDom format
 * @param  {Object}        template    Template to render
 * @param  {Context}       context     Value for the current rendering context
 * @param  {Object}        partials    Object map of partial templates
 * @param  {Object}        parentView  ParentView to attach widgets to
 * @param  {Boolean}       firstRender Indicator that this is the first render
 * @return {Object|String}             Rendered VDom
 */
function renderVdom(template, context, partials, parentView, firstRender) {
  var result, i, j, value, valueLength;
  if (typeof template === 'string' || typeof template === 'undefined') {
    return template;
  } else if (Context.isArray(template)) {
    result = [];
    // Sometimes a single child object returns an array of values, usually a section or a partial
    // This flattens the array so that there's no nesting
    var needsFlatten = false;
    // VDom will occasionally give us adjacent text nodes, which don't occur naturally in the browser
    // This sets a naive check to see if we need to combine these nodes
    var needsStringFlattening = false;
    // Falsy values will return null or undefined. This filters that off the child array
    var needsFilter = false;
    for (i = 0; i < template.length; i++) {
      result[i] = renderVdom(template[i], context, partials, parentView, firstRender);
      needsFlatten = needsFlatten || Context.isArray(result[i]);
      needsStringFlattening = needsStringFlattening || typeof result[i] === 'string';
      needsFilter = needsFilter || typeof result[i] === 'undefined';
    }

    // If a partial or section was rendered, we often get a nested array
    // This flattens it to a single depth
    if (needsFlatten) {
      result = _.flatten(result);
    }

    // Adjacent strings need to be combined since Browsers don't treat them as separate
    // If we create two sibling VirtualTexts, it throws off the index count and gets a weird render
    if (needsStringFlattening) {
      var appendTo = null;
      for (i = 0; i < result.length; i++) {
        if (typeof result[i] === 'string') {
          if (appendTo !== null) {
            result[appendTo] += result[i];
            result[i] = undefined;
            needsFilter = true;
          } else {
            appendTo = i;
          }
        } else if (result[i] != null) {
          appendTo = null;
        }
      }
    }

    // IE8 and back don't generate whitespace-only text nodes from downloaded HTML
    // to keep VDOM consistent, we strip any of those out
    if (!supportsWhitespaceTextNodes) {
      for (i = 0; i < result.length; i++) {
        if (whitespaceOnlyRegex.test(result[i])) {
          result[i] = undefined;
          needsFilter = true;
        }
      }
    }
    // Removing null values from
    if (needsFilter) {
      result = _.filter(result, function(r) {
        return r != null;
      });
    }

    // If an array contains only a single empty string text node, the element is just empty
    if (firstRender && result.length === 1 && result[0] === '') {
      result.length = 0;
    }

    return result;
  } else if (template.type === 'Widget') {
    // Widgets are how we attach Views to subtrees
    // If we have a parentView, we're rendering Vdom, if not this is rendering to Dom or string, so ignore
    if (parentView) {
      // If we have a parent view, attach this as a widget so the child view will render and attach
      result = new template.constructor(template.template, template.childView, context, parentView, firstRender);
    } else {
      // If we aren't in the context of a view, just render out the widget without attaching the child view
      result = template.template.toVdom(context);
    }
    return result;
  }

  switch (template.t) {
    // <!-- comment -->
    case ractiveTypes.COMMENT:
      return new HTMLCommentWidget(renderVdom(template.c, context, partials, parentView, firstRender));
    // {{value}} or {{{value}}} or {{& value}}
    case ractiveTypes.INTERPOLATOR:
    case ractiveTypes.TRIPLE:
      value = context.lookup(Context.getInterpolatorKey(template));
      if (value != null) {
        // @TODO is this duplicated functionality from template_context?
        if (typeof value === 'function') {
          value = value.call(context.view);
        }
        value = value.toString();
        if (template.t === ractiveTypes.TRIPLE) {
          // TRIPLE is unescaped content, so parse that out into VDOM as needed
          value = parseUnescapedString(value);
        }
        return value;
      }
      return '';

    // {{> partial}}
    case ractiveTypes.PARTIAL:
      var partialName = Context.getInterpolatorKey(template);
      result = null;
      if (partialName.substr(0, 4) === 'dyn_') {
        var key = partialName.substr(4);
        partialName = context.lookup('dynamic_partials.' + key);
        if (partialName == null) {
          logger.warn('Warning: Dynamic partial template referenced, but not defined: ' + key);
          return result;
        }
        if (!partials[partialName]) {
          partials[partialName] = Context.dynamicPartialResolver(partialName + '.mustache');
        }
        if (parentView && !partials[partialName].view) {
          partials[partialName] = partials[partialName].attachView(parentView, true);
        }
      }
      if (partials[partialName]) {
        var partialTemplate = partials[partialName];
        if (partialTemplate.templateObj) {
          partialTemplate = partialTemplate.templateObj;
        }
        result = renderVdom(partialTemplate, context, partials[partialName].partials || partials, parentView, firstRender);
      } else {
        // @TODO, perhaps return this string as the partial result so it renders to the page?
        logger.warn('Warning: no partial registered with the name ' + partialName);
      }
      return result;

    // {{# section}} or {{^ unless}}
    case ractiveTypes.SECTION:
      value = Context.parseValue(context.lookup(Context.getInterpolatorKey(template)));
      if (template.n === ractiveTypes.SECTION_UNLESS) {
        if (!value.isTruthy) {
          return renderVdom(template.f, context, partials, parentView, firstRender);
        }
      } else if (value.isTruthy) {
        // Sections become loops if an array or collection is passed
        if (value.isArray) {
          result = new Array(value.value.length);
          // Iterate over the collection
          for (j = 0, valueLength = value.value.length; j < valueLength; ++j) {
            result[j] = renderVdom(template.f, context.push(value.value[j]), partials, parentView, firstRender);
          }
          return result;
        } else if (typeof value.value === 'object' || typeof value.value === 'string') {
          // If the found value is an object or string, push it onto the context
          return renderVdom(template.f, context.push(value.value), partials, parentView, firstRender);
        } else {
          // Not an object or string usually means boolean, so don't bother pushing that
          return renderVdom(template.f, context, partials, parentView, firstRender);
        }
      }
      break;

    // DOM node
    case ractiveTypes.ELEMENT:
      var properties = {};
      var attributeHandler = function(values, attr) {
        var propName = transformPropertyName(attr);
        var attrString = renderAttributeString(values, context);
        if (propName === false) {
          properties.attributes = properties.attributes || {};
          properties.attributes[attr] = attrString;
        } else if (propName === 'autofocus') {
          properties.autofocus = new FocusHook();
        } else {
          properties[propName] = attrString;
        }
      };

      // Parse static attribute values
      _.each(template.a, attributeHandler);
      // Handle dynamic values if need be
      if (template.m) {
        _.each(parseStringAttrs(template.m, context), attributeHandler);
      }

      // Recuse into the elements' children
      var children = [];
      if (template.f) {
        children = renderVdom(template.f, context, partials, parentView, firstRender);
      }

      if (typeof properties.style === 'string') {
        var css = properties.style;
        properties.style = {
          cssText: css
        };
      }

      var node = tungsten.createVNode(template.e, properties, children);
      return node;
  }
}

/**
 * Renders the given data to Virtual DOM output
 * @param  {Object}  template    The pre-compiled template
 * @param  {Object}  data        The data to render with
 * @param  {Object}  partials    Map of registered templates
 * @param  {Object}  parentView  The view to attach
 * @param  {Boolean} firstRender Indicator that this is the first render
 * @return {Object}              The VDom result
 */
exports.renderToVdom = function renderToVdom(template, data, partials, parentView, firstRender) {
  // If rendering a widget, we'll pass an existing context through
  var context = (data && data.constructor && data instanceof Context) ? data : new Context(data);
  var result = renderVdom(template, context, partials, parentView, firstRender);
  return result;
};

/**
 * Renders the given data to DOM nodes
 * @param  {Object} template The pre-compiled template
 * @param  {Object} data     The data to render with
 * @param  {Object} partials Map of registered templates
 * @return {Object}          The DOM result
 */
exports.renderToDom = function renderToDom(template, data, partials) {
  var vdom = exports.renderToVdom(template, data, partials);
  return tungsten.toDOM(vdom);
};

/**
 * Renders the given data to string output
 * @param  {Object} template The pre-compiled template
 * @param  {Object} data     The data to render with
 * @param  {Object} partials Map of registered templates
 * @return {String}          The string result
 */
exports.renderToString = function renderToString(template, data, partials) {
  var vdom = exports.renderToVdom(template, data, partials);
  return tungsten.toString(vdom);
};

module.exports = exports;
