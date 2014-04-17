/*
 * Kanban chart functionality by Tuma Solutions.
 * Copyright (C) 2010-2011 Tuma Solutions, LLC.  All rights reserved.
 *
 * This file is NOT open source.  It can not be copied, modified, or
 * reused without prior written permission from Tuma Solutions, LLC.
 *
 * Unauthorized reuse of this file or portions thereof is a federal
 * copyright violation, and is punishable by fines of up to $100,000
 * per infraction and/or prison sentence.
 *
 * For more information, or to request permission to reuse this file,
 * contact <kanban@tuma-solutions.com>
 */

var TsKanbanChartEditor = {

   charts: {},

   init: function() {
      TsKanbanChartEditor.setupPopupCalendars();
      TsKanbanChartEditor.setupAssignedToAutocompletion();
      TsKanbanChartEditor.focusFirstElem();
   },

   setupPopupCalendars: function() {
      // arrange for all date elements to display a popup calendar
      var openCal = TsKanbanChartEditor.openCalendar.bindAsEventListener();
      $A(document.getElementsByClassName("dateItem")).each(function(e) {
            e.getElementsByTagName("input")[0].onfocus = openCal; });
   },

   setupAssignedToAutocompletion: function() {
      // set up autocompletion on the "assigned to" field
      var assignedTo = $("assignedTo");
      if (!assignedTo) return;

      // lookup the chart object that opened this window.
      var chartId = $("chartId").value;
      var chart = window.opener.TsKanbanChartEditor.charts[chartId];
      if (!chart) return;

      // retrieve the list of "assigned to" names
      var names = chart.getAssignedToNames();
      if (names) {
         new Autocompleter.Local(assignedTo, "tsKanbanAutocomplete",
            names, { });
      }
   },

   focusFirstElem: function() {
      var e = document.getElementById("taskName");
      if (e) e.focus();
   },

   openCalendar: function(event) {
      var formElem = Event.findElement(event, "input");
      formElem.select();
      JACS.show(formElem, event);
   },

   taskSaved: function(chartId, taskId, refreshToken) {
      var script = "TsKanbanChartEditor._refreshTask('" + chartId
            + "', '" + taskId + "', " + refreshToken + ")";
      window.opener.setTimeout(script, 10);
      self.setTimeout("window.close()", 1000);
   },

   _refreshTask: function(chartId, taskId, refreshToken) {
      var chart = this.charts[chartId];
      if (chart) chart.refreshTask(taskId, refreshToken);
   },

   taskDeleted: function(chartId, taskId, refreshToken) {
      var task = $(taskId);
      if (task) {
         Effect.BlindUp(task, {
            afterFinish: function(effect) { effect.element.remove(); }
         });
      }
   },

   taskMoved: function(chartId, taskId, refreshToken) {
      // nothing to do.
   },

   dragObserver: {

      element: null,

      onStart: function(eventName, draggable, event) {
         // instruct overLIB to hide any tooltip which might be visible
         nd();
      },

      onEnd: function(eventName, draggable, event) {
         if (Element.hasClassName(draggable.element, "tsKanbanSundryTask")) {
            var task = draggable.element;
            var chartId = task.id.split("Task_")[0];
            var chart = TsKanbanChartEditor.charts[chartId];
            if (chart) chart.taskWasDragged(task);
         }
      },

      initialize: function() {
         if (!this.initialized) {
            Draggables.addObserver(this);
            this.initialized = true;
         }
      }
   }

};



var TsKanbanChart = Class.create();
TsKanbanChart.prototype = {

   // the ID namespace of this chart
   chartId: "",

   chartElem: null,

   taskListName: "",

   assignedToNames: {},

   effectivePersonFilter: "*",

   readOnly: null,

   initialize: function(chartId, taskListName) {
      this.chartId = chartId;
      TsKanbanChartEditor.charts[chartId] = this;

      this.chartElem = $(chartId);
      this.taskListName = taskListName;
      this.readOnly = this.chartElem.hasClassName("tsKanbanReadOnly");

      if (!this.readOnly) TsKanbanChartEditor.dragObserver.initialize();

      this.setupSortables();
      this.setupHtml(this.chartElem);
      this.setupLinks(null, "tsKanbanAddTask", this.addTask);
      this.setupLinks(null, "tsKanbanOptions", this.showOptionsMenu);
   },

   setupSortables: function() {
      if (this.readOnly) return;
      var taskColumns = document.getElementsByClassName("tsKanbanTaskHolder",
         this.chartElem);
      $A(taskColumns).each(function(oneColumn) {
            Sortable.create(oneColumn, {
               tag: 'div',
               only: 'tsKanbanSundryTask',
               containment: taskColumns,
               dropOnEmpty: true,
               hoverclass: 'tsKanbanTaskHolderHover',
               constraint: ''
            });
         });
   },

   setupHtml: function(elem) {
      this.initializeTooltips(elem);
      this.setupLinks(elem, "tsKanbanShowMore", this.showMoreItems);
      this.setupLinks(elem, "tsKanbanEdit", this.editTask);
      this.setupLinks(elem, "tsKanbanDelete", this.deleteTask);
      this.enumerateAssignedToNames(elem);
   },

   enumerateAssignedToNames: function(elem) {
      var taskAssignments = document.getElementsByClassName
         ("tsKanbanAssigned", elem);
      for (var i = 0; i < taskAssignments.length; i++) {
         var who = this.getTextOrTipContent(taskAssignments[i]);
         this.assignedToNames[who] = 1;
      }
   },

   getAssignedToNames: function() {
      return $H(this.assignedToNames).keys().sort();
   },

   initializeTooltips: function(elem) {
      var mouseOver = this.mouseOverToolTip.bindAsEventListener(this);
      var mouseOut = this.mouseOutToolTip.bindAsEventListener(this);

      var elementsWithTips = document.getElementsByClassName("tsKanbanHasTip",
            elem);
      for (var i = 0; i < elementsWithTips.length; i++) {
         elementsWithTips[i].onmouseover = mouseOver;
         elementsWithTips[i].onmouseout = mouseOut;
      }      
   },

   mouseOverToolTip: function(event) {
      // do not display tooltips when a drag is in progress
      if ((typeof Draggables != 'undefined') && Draggables.activeDraggable) return;

      // Get the HTML element that contains the active tooltip
      if (!event) return;
      var elem = Event.element(event);
      if (!Element.hasClassName(elem, "tsKanbanHasTip")) elem = elem.parentNode;
      if (!Element.hasClassName(elem, "tsKanbanHasTip")) return;

      // find the HTML element containing the active tooltip, and extract
      // the tip HTML
      var tipElem = this.getSingleElement(elem, "tsKanbanTooltip");
      if (!tipElem) return;
      var tipHTML = tipElem.innerHTML;

      // examine the tip element for customization instructions
      var wrapping = WRAP;
      if (Element.hasClassName(tipElem, "tsKanbanWidthTip")) wrapping = DONOTHING;
      var delay = 0;
      if (Element.hasClassName(tipElem, "tsKanbanSlowTip")) delay = 500;

      // display the tooltip
      overlib(tipHTML, WIDTH, 200, DELAY, delay, FGCOLOR, "#333333", 
            TEXTCOLOR, "#ffffff", wrapping);
   },

   mouseOutToolTip: function(event) {
      nd();
   },


   showOptionsMenu: function(event) {
      nd();

      var optionsLink = Event.element(event);
      this.optionsMenu = this.getSingleElement(optionsLink.parentNode,
            "tsKanbanOptionsMenu");
      if (!this.optionsMenu) return false;
      if (Element.visible(this.optionsMenu)) return this.hideOptionsMenu();

      this.buildPersonFilterMenu(this.optionsMenu);

      Element.show(this.optionsMenu);
      return false;
   },

   hideOptionsMenu: function() {
      if (this.optionsMenu)
         Element.hide(this.optionsMenu);
      return false;
   },

   buildPersonFilterMenu: function(optionsMenu) {
      var personFilter = this.getSingleElement(optionsMenu,
            "tsKanbanPersonFilter");
      if (!personFilter)
         return;

      var items = personFilter.getElementsByTagName("li");
      var everyone = items[0];
      var noOne = this.getSingleElement(personFilter,
            "tsKanbanPersonUnassigned");
      $A(items).slice(1).each(Element.remove);

      everyone.onclick = this.setPersonFilterEveryone.bindAsEventListener(this);
      this.toggleClass(everyone, "tsKanbanFilterSelected",
            this.effectivePersonFilter == "*");

      var clickHandler = this.setPersonFilter.bindAsEventListener(this);
      var names = this.getAssignedToNames();
      for (var i = 0;   i < names.length;  i++) {
         var nameElem = document.createElement("li");
         nameElem.appendChild(document.createTextNode(names[i]));
         nameElem.onclick = clickHandler;
         if (names[i] == this.effectivePersonFilter)
            Element.addClassName(nameElem, "tsKanbanFilterSelected");
         personFilter.appendChild(nameElem);
      }

      if (noOne) {
         noOne.onclick = this.setPersonFilterNoOne.bindAsEventListener(this);
         this.toggleClass(noOne, "tsKanbanFilterSelected",
               this.effectivePersonFilter == null);
         personFilter.appendChild(noOne);
      }
   },

   setPersonFilterEveryone: function(event) {
      return this.setPersonFilter(event, "*");
   },

   setPersonFilterNoOne: function(event) {
      return this.setPersonFilter(event, null);
   },

   setPersonFilter: function(event, nameToShow) {
      this.hideOptionsMenu();
      Event.stop(event);

      if (arguments.length < 2)
         nameToShow = this.getTextOrTipContent(Event.findElement(event, "li"));

      document.body.style.cursor = "wait";
      this.effectivePersonFilter = nameToShow;
      setTimeout(this.setPersonFilterImpl.bind(this, nameToShow), 20);

      return false;
   },

   setPersonFilterImpl: function(nameToShow) {
      $A(document.getElementsByClassName("tsKanbanTask", this.chart)).each(
            this.applyPersonFilter.bind(this, nameToShow));
      document.body.style.cursor = "auto";
   },

   applyPersonFilter: function(nameToShow, taskBlock) {
      var taskAssignedTo = "*";
      if (nameToShow != "*")
         taskAssignedTo = this.getTaskAssignedTo(taskBlock);
      this.toggleClass(taskBlock, "tsKanbanPersonFiltered",
            nameToShow != taskAssignedTo);
   },


   showMoreItems: function(event) {
      // Get the HTML "div" element that contains the "show more" link
      if (!event) return false;
      var elem = Event.findElement(event, "div");
      if (!elem) return false;

      Element.hide(elem);
      while (true) {
         elem = elem.nextSibling;
         if (elem == null) break;
         if (elem.tagName) {
            Element.show(elem);
            if (Element.hasClassName(elem, "tsKanbanDivider")) break;
         }
      }

      return false;
   },

   addTask: function(event) {
      this.openTaskEditor(null);

      return false;
   },

   editTask: function(event) {
      // Get the HTML block for the sundry task containing the "edit" link
      var task = this.findTaskBlock(event, true);
      if (task) this.openTaskEditor(task.id);

      return false;
   },

   openTaskEditor: function(taskId) {
      if (!this.readOnly) {
         window.open(this._editTaskUrl(taskId), "_blank",
               "width=320,height=375,resizable=1").focus();
      }
      return false;
   },

   refreshTask: function(taskId, refreshToken) {
      var url = self.location.href.replace(/\#.*/, "");
      new Ajax.Request(url, {
         method: 'get',
         parameters: "taskId=" + encodeURIComponent(taskId) +
                     "&rl=" + encodeURIComponent(refreshToken),
         onComplete: this._refreshTaskCallback.bind(this, taskId) });
   },

   _refreshTaskCallback: function(taskId, ajax) {
      var destColumnId = ajax.getResponseHeader("X-Kanban-Dest-Column");
      var destColumn = $(destColumnId);
      var taskBlock = $(taskId);
      var resetSortables = this.setupSortables.bind(this);

      if (taskBlock) {
         taskBlock.replace(ajax.responseText);
         taskBlock = $(taskId);
         this.setupHtml(taskBlock);
         if (!taskBlock.childOf(destColumn)) {
            Element.hide(taskBlock);
            destColumn.insertBefore(taskBlock, destColumn.firstChild);
            Effect.BlindDown(taskBlock, { afterFinish: resetSortables });
         }
      } else {
         new Insertion.Top(destColumn, ajax.responseText);
         taskBlock = $(taskId);
         this.setupHtml(taskBlock);
         Element.hide(taskBlock);
         Effect.BlindDown(taskBlock, { afterFinish: resetSortables });
      }
   },

   deleteTask: function(event) {
      this._deleteTask(event);
      return false;
   },

   _deleteTask: function(event) {
      if (this.readOnly) return;

      // Get the HTML block for the task containing the "delete" link
      var task = this.findTaskBlock(event, true);

      // Get the name of the task, so we can display it to the user.
      var taskName = this.getTaskName(task);
      if (taskName == null) return;

      // Ask the user if they are certain they want to delete the task.
      var userChoice = window.confirm(
         "Are you certain you want to delete the task '" + taskName + "'?");
      if (userChoice) {
         var url = this._editTaskUrl(task.id) + "&action=delete";
         new Ajax.Request(url);
      }
   },

   taskWasDragged: function(task) {
      var column = this.findParentWithClass(task, "tsKanbanTaskHolder");
      if (column) {
         var url = this._editTaskUrl(task.id) + "&action=changeColumn"
            + "&newColumn=" + encodeURIComponent(column.id);
         new Ajax.Request(url);
      }
   },

   _editTaskUrl: function(taskId, otherParams) {
      var result = window.location.protocol + "//" + window.location.host
              + "/" + encodeURIComponent(this.taskListName)
              + "//extras/kanbanEditTask"
              + "?chartId=" + encodeURIComponent(this.chartId);

      if (taskId) result = result + "&taskId=" + encodeURIComponent(taskId);

      return result;
   },

   findTaskBlock: function(event, requireSundry) {
      if (!event) return null;
      var element = Event.findElement(event, "div");
      var result = this.findParentWithClass(element, "tsKanbanTask");
      if (result && requireSundry && !Element.hasClassName(result,
               "tsKanbanSundryTask")) result = null;
      return result;
   },

   findParentWithClass: function(element, className) {
      while (element && !Element.hasClassName(element, className))
         element = element.parentNode;
      return element;
   },

   getTaskName: function(taskBlock) {
      var titleDiv = this.getSingleElement(taskBlock, "tsKanbanTaskTitle");
      return this.getTextOrTipContent(titleDiv);
   },

   getTaskAssignedTo: function(taskBlock) {
      var assignedTo = this.getSingleElement(taskBlock, "tsKanbanAssigned");
      return this.getTextOrTipContent(assignedTo);
   },

   getTextOrTipContent: function(elem) {
      var toolTip =  this.getSingleElement(elem, "tsKanbanTooltip");
      if (toolTip) {
         return toolTip.innerText || toolTip.textContent;
      } else if (elem) {
         return elem.innerText || elem.textContent;
      } else {
         return null;
      }
   },

   getSingleElement: function(elem, className) {
      if (!elem || !className) return null;
      var list = document.getElementsByClassName(className, elem);
      if (!list || list.length == 0) return null;
      return list[0];
   },

   toggleClass: function(elem, className, flag) {
      var func = (flag ? Element.addClassName : Element.removeClassName);
      func(elem, className);
   },

   setupLinks: function(elem, className, handlerFunc) {
      var handler = handlerFunc.bindAsEventListener(this);
      var links = document.getElementsByClassName(className,
            elem || this.chartElem);
      for (var i = 0; i < links.length; i++) {
         links[i].onclick = handler;
      }
   }

};
