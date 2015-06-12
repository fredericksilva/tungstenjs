/**
 * Template constructor
 *
 * @author    Matt DeGennaro <mdegennaro@wayfair.com>
 */
'use strict';

var _ = require('underscore');
var templateToVdom = require('./template_to_vdom');
var ractiveTypes = require('./ractive_types');
var Context = require('./template_context');
var logger = require('./../utils/logger');

/**
 * Hash of registered partials
 * @type {Object}
 */
var registeredPartials = {};

var Template = function(templateObj, partials, view) {
  this.templateObj = templateObj;
  this.partials = partials;
  this.view = view;
};

Template.prototype.setPartials = function(partials) {
  this.partials = partials;
};

/**
 * Registers a template as a named partial
 * @param  {String} partialName Name to register the partial as
 */
Template.prototype.register = function(partialName) {
  registeredPartials[partialName] = this.templateObj;
};
/**
 * Outputs the template to a HTML string
 * @param  {Object} data Model to render the template with
 * @return {String}      HTML string of the rendered template
 */
Template.prototype.toString = function(data) {
  return templateToVdom.renderToString(this.templateObj, data, this.partials || registeredPartials);
};
/**
 * Outputs the template to a DocumentFragment
 * @param  {Object} data Model to render the template with
 * @return {Object}      DocumentFragment containing the template's DOM nodes
 */
Template.prototype.toDom = function(data) {
  var domFrag = templateToVdom.renderToDom(this.templateObj, data, this.partials || registeredPartials);
  // If we've attached a top level view, there will be a wrapper div that needs to be removed
  if (this.view && !this.view.parentView) {
    var viewWrapper = domFrag.childNodes[0];
    while (viewWrapper.childNodes.length) {
      domFrag.appendChild(viewWrapper.childNodes[0]);
    }
    domFrag.removeChild(viewWrapper);
  }
  return domFrag;
};
/**
 * Outputs the template to a VirtualTree
 * @param  {Object}  data        Model to render the template with
 * @param  {Boolean} firstRender Indicator that this is the first render
 * @return {Object}              VirtualTree representing the template
 */
Template.prototype.toVdom = function(data, firstRender) {
  return templateToVdom.renderToVdom(this.templateObj, data, this.partials || registeredPartials, this.view, firstRender);
};

/**
 * Iterate over the template to attach a view's childViews
 * @todo attach events?
 * @param  {Object}   view          View to attach
 * @param  {Object}   template      Template object to attach to
 * @param  {Function} widgetWrapper Constructor function to wrap childViews with
 * @param  {Object}   partials      Dictionary to lookup partials from
 * @param  {Object}   childClasses  Classes to look for for this View wrapper
 * @return {Object}                 Template object with attached view
 */
var attachViews = function(view, template, widgetWrapper, partials, childClasses) {
  var i;

  // String is a dead-end
  if (typeof template === 'string') {
    return template;
  }

  // Arrays need iterating over
  if (Context.isArray(template)) {
    for (i = 0; i < template.length; i++) {
      template[i] = attachViews(view, template[i], widgetWrapper, partials, childClasses);
    }
    // short circuit
    return template;
  }

  // If the view has childViews and this isn't the root, attempt to attach Widget
  if (!template.root && view.childViews) {
    // If cached version hasn't been passed down, parse childViews into an array of class names
    if (!childClasses) {
      childClasses = {};
      childClasses.flat = _.keys(view.childViews);
      childClasses.padded = _.map(childClasses.flat, function(key) {
        return ' ' + key + ' ';
      });
      childClasses.length = childClasses.flat.length;
    }
    // If this is an element with a class property, see if we should attach Widget
    if (template.a && template.a['class']) {
      var className = template.a['class'];
      // If className has dynamic values, filter them out to just the static ones
      if (typeof className !== 'string') {
        className = _.filter(className, function(obj) {
          return typeof obj === 'string';
        });
        className = className.join(' ');
      }
      // Pad with spaces for better hasClass-ing
      className = ' ' + className + ' ';
      for (i = childClasses.length; i--; ) {
        if (className.indexOf(childClasses.padded[i]) > -1) {
          // If we match a childView class, replace the template with a Widget
          template = {
            type: 'Widget',
            constructor: widgetWrapper,
            childView: view.childViews[childClasses.flat[i]],
            template: new Template(template, partials)
          };
          break;
        }
      }
    }
  }

  // Recurse on any child elements
  if (template.f) {
    for (i = 0; i < template.f.length; i++) {
      template.f[i] = attachViews(view, template.f[i], widgetWrapper, partials, childClasses);
    }
    // in the event of a partial, we may get a nested array, this flattens it out
    template.f = _.flatten(template.f, true);
  }

  // If this is a partial, lookup and recurse
  if (template.t === ractiveTypes.PARTIAL) {
    var partialName = Context.getInterpolatorKey(template);
    if (partialName.substr(0, 4) === 'dyn_') {
      // Partial needs to be resolved at runtime
      return template;
    }
    if (!partials[partialName]) {
      logger.warn('Warning: no partial registered with the name ' + partialName);
      return null;
    } else {
      var partialTemplate = partials[partialName];
      if (partialTemplate.templateObj) {
        partialTemplate = partialTemplate.templateObj;
      }
      template = attachViews(view, _.clone(partialTemplate), widgetWrapper, partials[partialName].partials || registeredPartials, childClasses);
    }
  }

  return template;
};

/**
 * Exposed function to attachView
 * @param  {Object}   view       View to attach to
 * @param  {Boolean}  isDynamic  Indicates that this is a dynamic partial being attached on the fly
 * @return {Template}            New template with updated template object
 */
Template.prototype.attachView = function(view, isDynamic) {
  var templateObj = _.clone(this.templateObj);
  templateObj.root = true;
  // If this view is the top level wrapper, create a fake element to wrap it in
  if (!isDynamic && !view.parentView) {
    // Create wrapper element based on view's element
    templateObj = {
      't': ractiveTypes.ELEMENT,
      'e': view.el.nodeName,
      'f': templateObj
    };
    // If there's a mismatch in childNode counts, it's usually extra whitespace from the server
    // We can trim those off so that the VTree is unaffected during lookups
    // Since this is in the form of whitespace around the template, it's a simple type check on the first and last node
    if (templateObj.f.length !== view.el.childNodes.length) {
      // If the first part of the template is a string or the first node isn't a textNode, assume that's fine
      if (typeof templateObj.f[0] !== 'string' && view.el.childNodes[0].nodeType === 3) {
        view.el.removeChild(view.el.childNodes[0]);
      }
      // If the last part of the template is a string or the last node isn't a textNode, assume that's fine
      var lastNode = view.el.childNodes[view.el.childNodes.length - 1];
      if (typeof templateObj.f[templateObj.f.length - 1] !== 'string' && lastNode && lastNode.nodeType === 3) {
        view.el.removeChild(lastNode);
      }

      // If neither of the above, something's borked
      if (templateObj.f.length !== view.el.childNodes.length) {
        // This is also logged if there are HTML comments in your template; @todo find an alternative solution
        logger.info('DOM does not match given template, consider using dynamicInitialize.');
      }
    }
  }
  templateObj = attachViews(view, templateObj, Context.WidgetWrapper, this.partials || registeredPartials);
  return new Template(templateObj, this.partials, view);
};

module.exports = Template;
