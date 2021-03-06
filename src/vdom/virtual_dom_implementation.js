/**
 * Exposes bits of the virtual-dom library for use in Tungsten
 * @author    Matt DeGennaro <mdegennaro@wayfair.com>
 */
'use strict';

var vdom = require('virtual-dom');
var VNode = require('virtual-dom/vnode/vnode');
var VText = require('virtual-dom/vnode/vtext');
var isVNode = require('virtual-dom/vnode/is-vnode');
var isVText = require('virtual-dom/vnode/is-vtext');
var isWidget = require('virtual-dom/vnode/is-widget');
var domToVdom = require('./dom_to_vdom');

module.exports = {
  vdom: vdom,
  domToVdom: domToVdom,
  VNode: VNode,
  VText: VText,
  isVNode: isVNode,
  isVText: isVText,
  isWidget: isWidget
};