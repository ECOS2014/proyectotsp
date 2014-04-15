/*
 * Gantt chart functionality by Tuma Solutions.
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
 * contact <gantt@tuma-solutions.com>
 */
 
var TsGanttChartResizeHandler = {

   startDrag: function(event, target, callback) {
      this.endDrag(null);
      if (!event || !target) return;

      this.startX = event.clientX;
      this.resizeTarget = target;
      this.initialWidth = target.offsetWidth;
      this.resizeCallback = callback;

      Event.observe(document, "mouseup", this.eventEndDrag);
      Event.observe(document, "mousemove", this.eventMouseMove);
   },

   doResize: function(event) {
      if (!this.resizeTarget || !event) return;

      var currentX = event.clientX;
      var delta = currentX - this.startX;
      var newWidth = Math.round(this.initialWidth + delta);

      this.resizeTarget.style.width = newWidth + 'px';

      if (this.resizeCallback) this.resizeCallback();

      return false;
   },

   endDrag: function(event) {
      if (!this.resizeTarget) return;

      this.doResize(event);
      this.resizeTarget = null;
      this.resizeCallback = null;
      Event.stopObserving(document, "mouseup", this.eventEndDrag);
      Event.stopObserving(document, "mousemove", this.eventMouseMove);
      return false;
   },

   init: function() {
      this.eventEndDrag = this.endDrag.bindAsEventListener(this);
      this.eventMouseMove = this.doResize.bindAsEventListener(this);
   },

   dispose: function() {
      this.endDrag(null);
   }

}
TsGanttChartResizeHandler.init();


var TsGanttChartDragScrollHandler = {

   startDrag: function(event, target) {
      this.endDrag(null);
      if (!event || !target) return;

      this.startX = event.clientX;
      this.startY = event.clientY;
      this.scrollTarget = target;
      this.initialScroll = target.scrollLeft;

      var docElem = document.documentElement;
      if (docElem && (docElem.scrollTop || docElem.scrollLeft)) {
         this.initialPageY = docElem.scrollTop;
         this.initialPageX = docElem.scrollLeft;
      } else if (document.body) {
         this.initialPageY = document.body.scrollTop;
         this.initialPageX = document.body.scrollLeft;
      } else {
         this.initialPageY = -1;
      }

      Event.observe(document, "mouseup", this.eventEndDrag);
      Event.observe(document, "mousemove", this.eventMouseMove);
   },

   doDragScroll: function(event) {
      if (!this.scrollTarget || !event) return;

      var currentX = event.clientX;
      var delta = currentX - this.startX;
      var newScroll = this.initialScroll - delta;
      newScroll = Math.max(0, newScroll);
      this.scrollTarget.scrollLeft = newScroll;

      if (this.initialPageY >= 0) {
         var currentY = event.clientY;
         delta = currentY - this.startY;
         newScroll = this.initialPageY - delta;
         window.scrollTo(this.initialPageX, newScroll);
      }

      return false;
   },

   endDrag: function(event) {
      if (!this.scrollTarget) return;

      this.doDragScroll(event);
      this.scrollTarget = null;
      Event.stopObserving(document, "mouseup", this.eventEndDrag);
      Event.stopObserving(document, "mousemove", this.eventMouseMove);
      return false;
   },

   init: function() {
      this.eventEndDrag = this.endDrag.bindAsEventListener(this);
      this.eventMouseMove = this.doDragScroll.bindAsEventListener(this);
   },

   dispose: function() {
      this.endDrag(null);
   }

}
TsGanttChartDragScrollHandler.init();


var TsGanttChart = Class.create();
TsGanttChart.prototype = {

   // the ID namespace of this chart
   chartId: "",

   // a list of objects representing the rows in the GANTT chart
   rows: [],

   // a list of objects representing the dependencies in the GANTT chart
   dependencies: [],

   // a cache of various page elements we need
   elems: {},

   // the earliest and latest timestamps for the GANTT data
   chartStartTS: 0,  chartFinishTS: 0,

   // the number of milliseconds reprsented by each horizontal pixel
   scale: 0,


   initialize: function(chartId, minDate, maxDate, showLevel, firstDayOfWeek) {
      var methodTimer = new Date();

      // register a shutdown event to be called when the page is closed
      Event.observe(window, 'unload', this.dispose.bindAsEventListener(this), false);

      // save the basic information provided about this chart
      this.chartId = chartId;
      this.chartStartTS = minDate;
      this.chartFinishTS = maxDate;
      this.firstDayOfWeek = firstDayOfWeek;

      // look up several page elements we will use often
      this.elems = {
         leftTable:   $(this.chartId + "L_table"),
         leftHeader:  $(this.chartId + "L_header"),
         leftData:    $(this.chartId + "L_dataHolder"),
         rightTD:     $(this.chartId + "R_td"),
         rightTable:  $(this.chartId + "R_table"),
         rightHeader: $(this.chartId + "R_header"),
         dateHolder:  $(this.chartId + "R_dateHolder"),
         rightData:   $(this.chartId + "R_dataHolder")
      };

      this.setDefaultColumnSizes();

      // create reusable event handlers for table-row-related events
      this.eventMouseOverRow = this.mouseOverRow.bindAsEventListener(this);
      this.eventUnhighlightRow = this.unhighlightRow.bind(this);
      this.eventMouseOverTask = this.mouseOverTask.bindAsEventListener(this);
      this.eventMouseOutTask = this.mouseOutTask.bindAsEventListener(this);
      this.eventToggleRow  = this.toggleRow.bindAsEventListener(this);

      // now build all the row and dependency objects
      this.rows = [];
      this.dependencies = [];
      this.chartRowLabelPad = this.STD_LABEL_PAD;

      var leftTableRows = this.elems.leftTable.getElementsByTagName("tr");
      var rightTableRows = this.elems.rightTable.getElementsByTagName("tr");

      for (var i = 0; i < leftTableRows.length; i++)
         this.rows.push(this.makeRow(i, leftTableRows[i], rightTableRows[i], showLevel));

      for (var i = 0; i < this.dependencies.length; i++)
         this.resolveDependency(this.dependencies[i]);

      // scale the chart vertically and horizontally
      this.handleTableHeightChange();
      this.autoscale();

      // assign event handlers to various chart elements

      var eventMouseOutTable = this.mouseOutTable.bindAsEventListener(this);
      this.elems.leftTable.onmouseout = eventMouseOutTable;
      this.elems.rightTable.onmouseout = eventMouseOutTable;

      var eventMouseDownTable = this.mouseDownTable.bindAsEventListener(this);
      this.elems.leftTable.onmousedown = eventMouseDownTable;
      this.elems.rightTable.onmousedown = eventMouseDownTable;

      this.elems.rightTable.ondblclick = this.doubleClickTask.bindAsEventListener(this);

      this.eventAfterColumnResize = this.afterColumnResize.bind(this);
      $(this.chartId + "L_resize").onmousedown = this.resizeLeft.bindAsEventListener(this);
      $(this.chartId + "R_resize").onmousedown = this.resizeRight.bindAsEventListener(this);

      $(this.chartId + "zoomIn").onclick = this.zoomIn.bindAsEventListener(this);
      $(this.chartId + "zoomOut").onclick = this.zoomOut.bindAsEventListener(this);
      $(this.chartId + "zoomFit").onclick = this.autoscale.bindAsEventListener(this);

      var configButton = $(this.chartId + "config");
      if (configButton)
         configButton.onclick = this.showChartConfig.bindAsEventListener(this);

      this.showElapsed("initialize v2", methodTimer);
   },

   dispose: function() {
      this.rows = [];
      this.dependencies = [];
      this.elems = {};
      TsGanttChartResizeHandler.dispose();
      TsGanttChartDragScrollHandler.dispose();
      if (this.debug) window.alert("dispose called!");
   },


   makeRow: function(rowNum, leftTR, rightTR, showLevel) {
      var result = {};

      var rowData = leftTR.firstChild.lastChild.id.split(':');

      result.indent = parseInt(rowData[1]);
      result.startTS = parseInt(rowData[2]);
      result.finishTS = parseInt(rowData[3]);
      result.leftTR = leftTR;
      result.rightTR = rightTR;
      result.bar = result.rightTR.firstChild.firstChild.firstChild;
      result.label = result.rightTR.firstChild.firstChild.lastChild;
      result.needsScale = true;

      if (result.indent > showLevel) {
         result.hidden = true;
         result.needsInit = true;
      } else {
         result.hidden = false;
         this.initRow(result);
      }

      for (var i = 4; i < rowData.length; i++) {
         var depRowNum = rowData[i];

         var oneDep = {};
         oneDep.firstRowNum = depRowNum;
         oneDep.secondRowNum = rowNum;
         oneDep.upwards = (rowNum < depRowNum);
         oneDep.hidden = true;
         oneDep.needsInit = true;
         oneDep.needsScale = true;

         this.dependencies.push(oneDep);
      }

      return result;
   },

   initRow: function(row) {
      var taskSpan;
      var anchor = row.leftTR.firstChild.firstChild.firstChild;
      if (anchor.tagName != 'A') {
         row.isLeaf = true;
         taskSpan = anchor;
      } else if (row.indent == 0) {
         anchor.onclick = this.expandAllRows.bindAsEventListener(this);
         taskSpan = anchor.nextSibling;
      } else {
         anchor.onclick = this.eventToggleRow;
         taskSpan = anchor.nextSibling;
      }

      row.tooltip = row.leftTR.firstChild.lastChild.innerHTML;

      taskSpan.onmouseover = this.eventMouseOverTask;
      taskSpan.onmouseout = this.eventMouseOutTask;
      row.bar.onmouseover = this.eventMouseOverTask;
      row.bar.onmouseout = this.eventMouseOutTask;

      row.leftTR.onmouseover = this.eventMouseOverRow;
      row.rightTR.onmouseover = this.eventMouseOverRow;

      row.needsInit = false;
   },

   resolveDependency: function(oneDep) {
      oneDep.firstRow = this.rows[oneDep.firstRowNum];
      oneDep.secondRow = this.rows[oneDep.secondRowNum];

      oneDep.firstRowPad = (oneDep.firstRow.bar.className == 'tsgSum' ? 5 : 0);
      oneDep.secondRowPad = (oneDep.secondRow.bar.className == 'tsgSum' ? 6 : 0);
   },

   initDependency: function(dep) {
      var lines = []; dep.lines = lines;

      dep.firstHolder = this.makeDiv("tsgDep", dep.firstRow.rightTR.firstChild, true);
      lines[0] = this.makeDiv("tsgDepH", dep.firstHolder);
      lines[1] = this.makeDiv("tsgDepV", dep.firstHolder);

      dep.secondHolder = this.makeDiv("tsgDep", dep.secondRow.rightTR.firstChild, true);
      lines[2] = this.makeDiv("tsgDepV", dep.secondHolder);
      lines[3] = this.makeDiv("tsgDepH", dep.secondHolder);
      lines[4] = this.makeDiv("tsgDepV", dep.secondHolder);
      lines[5] = this.makeDiv("tsgDepH", dep.secondHolder);
      lines[6] = this.makeDiv("tsgDepA", dep.secondHolder);

      lines[0].style.width = this.DEP_HORIZ_WIDTH + 'px';
      lines[4].style.height = '13px';

      if (dep.upwards) {
         lines[1].style.bottom = "-12px";
         lines[2].style.top = "24px";
         lines[3].style.top = "24px";
         lines[4].style.top = "12px";
      } else {
         lines[1].style.top = "12px";
         lines[2].style.bottom = "0px";
         lines[3].style.top = "0px";
         lines[4].style.top = "0px";
      }

      dep.needsInit = false;
   },


   expandAllRows: function() {
      var methodTimer = new Date();
      for (var i = 0; i < this.rows.length; i++) {
         var oneRow = this.rows[i];
         this.showRow(oneRow);
         if (!oneRow.isLeaf)
            Element.removeClassName(oneRow.leftTR, "tsgCollapsed");
      }
      this.handleTableHeightChange();
      this.showElapsed("expandAll", methodTimer);
      return false;
   },

   toggleRow: function(event) {
      var methodTimer = new Date();
      var rowNum = this.getRowNumForEvent(event);
      var chartRow = this.getRowForRowNum(rowNum);
      if (!chartRow) return;

      var expanding = Element.hasClassName(chartRow.leftTR, "tsgCollapsed");
      var startIndent = chartRow.indent;

      if (expanding) {
         Element.removeClassName(chartRow.leftTR, "tsgCollapsed");
         for (var i = rowNum + 1; i < this.rows.length; i++) {
            var oneRow = this.rows[i];
            var relativeIndent = oneRow.indent - startIndent;
            if (relativeIndent <= 0) {
               break;
            } else if (relativeIndent == 1) {
               this.showRow(oneRow);
               if (!oneRow.isLeaf)
                  Element.addClassName(oneRow.leftTR, "tsgCollapsed");
            }
         }

      } else {
         Element.addClassName(chartRow.leftTR, "tsgCollapsed");
         for (var i = rowNum + 1; i < this.rows.length; i++) {
            var oneRow = this.rows[i];
            var relativeIndent = oneRow.indent - startIndent;
            if (relativeIndent <= 0) {
               break;
            } else {
               this.hideRow(oneRow);
            }
         }
      }

      this.handleTableHeightChange();

      return false;
   },

   showRow: function(row) {
      if (row.needsInit) this.initRow(row);
      if (row.needsScale) this.scaleRow(row);

      Element.show(row.leftTR);
      Element.show(row.rightTR);
      row.hidden = null;
   },

   hideRow: function(row) {
      if (!row.hidden) {
         Element.hide(row.leftTR);
         Element.hide(row.rightTR);
         row.hidden = true;
      }
   },


   setDefaultColumnSizes: function() {
      var pageWidth = window.innerWidth || document.body.offsetWidth;
      if (pageWidth) {
         this.elems.leftData.style.width = Math.round(pageWidth * 0.35) + 'px';
         this.elems.rightData.style.width = Math.round(pageWidth * 0.6) + 'px';
      }
   },

   autoscale: function() {
      this.scaleToTimeInterval(this.chartStartTS, this.chartFinishTS);
      return false;
   },

   scaleToRow: function(row) {
      if (row && this.scaleToTimeInterval(row.startTS, row.finishTS)) {
         var scrollLeft = this.millisToPixels(row.startTS) - this.CHART_PAD_LEFT;
         this.elems.rightData.scrollLeft = scrollLeft;
      }
   },

   scaleToTimeInterval: function(startTS, finishTS) {
      if (!startTS || !finishTS)
         return false;

      var width = this.elems.rightTD.offsetWidth - this.TD_BORDER_WIDTH;
      var availableWidth = width - this.CHART_PAD_LEFT
            - this.LABEL_PAD_LEFT - this.chartRowLabelPad;
      var scale = (finishTS - startTS) / availableWidth;
      this.setScale(scale);
      return true;
   },

   zoomIn: function() {
      this.setScale(this.scale / this.ZOOM_FACTOR);
      return false;
   },

   zoomOut: function() {
      this.setScale(this.scale * this.ZOOM_FACTOR);
      return false;
   },

   setScale: function(scale) {
      if (this.chartStartTS <= 0 || this.chartFinishTS <= 0)
         return;

      this.scale = scale;

      // scale the table
      this.scaleTable();

      // scale the summary and task bars in the right table
      for (var i = 0; i < this.rows.length; i++) {
         var row = this.rows[i];
         if (row.hidden) {
            row.needsScale = true;
         } else {
             this.scaleRow(row);
         }
      }

      // scale the visible dependencies
      for (var i = 0; i < this.dependencies.length; i++) {
         var dep = this.dependencies[i];
         if (dep.hidden) {
            dep.needsScale = true;
         } else {
            this.scaleDependency(dep);
         }
      }
   },

   scaleTable: function() {
      var targetWidth = this.setRightTableAndHeaderWidth();
      this.rebuildDateLines(targetWidth);
   },

   setRightTableAndHeaderWidth: function() {
      var targetWidth = this.millisToPixels(this.chartFinishTS) +
            this.chartRowLabelPad + this.LABEL_PAD_LEFT;

      var rightSideWidth = this.elems.rightTD.offsetWidth - this.TD_BORDER_WIDTH;
      if (targetWidth < rightSideWidth)
         targetWidth = rightSideWidth;

      this.elems.rightTable.style.width = targetWidth + 'px';
      this.elems.rightHeader.style.width = targetWidth + 'px';

      return targetWidth;
   },

   scaleRow: function(row) {
      if (this.scale == 0)
         return;

      row.needsScale = false;

      if (!row.startTS) {
         this.leftPx = -1;
         this.rightPx = -1;
         return;
      }

      var leftPixel = this.millisToPixels(row.startTS);
      var rightPixel = this.millisToPixels(row.finishTS || this.chartFinishTS);
      var width = rightPixel - leftPixel;
      var labelPixel = rightPixel + this.LABEL_PAD_LEFT;

      row.leftPx = leftPixel;
      row.rightPx = leftPixel + width + 2 * this.BAR_BORDER_WIDTH;

      row.bar.style.left = leftPixel + 'px';
      row.bar.style.width = width + 'px';
      row.label.style.paddingLeft = labelPixel + 'px';
   },

   scaleDependency: function(dep) {
      if (this.scale == 0)
         return;

      var mainVertLeft = dep.firstRow.rightPx + dep.firstRowPad + this.DEP_HORIZ_WIDTH - 2;
      var secondRowLeft = dep.secondRow.leftPx - dep.secondRowPad - this.DEP_ARROW_WIDTH;

      dep.lines[0].style.left = (dep.firstRow.rightPx + dep.firstRowPad) + 'px';
      dep.lines[1].style.left = mainVertLeft + 'px';
      dep.lines[2].style.left = mainVertLeft + 'px';

      var xDelta = secondRowLeft - mainVertLeft - 1;
      if (xDelta >= this.DEP_HORIZ_WIDTH) {
         dep.lines[3].style.left = (mainVertLeft + 1) + 'px';
         dep.lines[3].style.width = '1px';
         dep.lines[4].style.left = mainVertLeft + 'px';
         dep.lines[5].style.left = (mainVertLeft + 1) + 'px';
         dep.lines[5].style.width = xDelta + 'px';
      } else {
         var secondVertLeft = secondRowLeft - this.DEP_HORIZ_WIDTH - 1;
         dep.lines[3].style.left = (secondVertLeft + 1) + 'px';
         dep.lines[3].style.width = (this.DEP_HORIZ_WIDTH - xDelta + 1) + 'px';
         dep.lines[4].style.left = secondVertLeft + 'px';
         dep.lines[5].style.left = (secondVertLeft + 1) + 'px';
         dep.lines[5].style.width = this.DEP_HORIZ_WIDTH + 'px';
      }

      dep.lines[6].style.left = secondRowLeft + 'px';

      dep.needsScale = false;
   },

   millisToPixels: function(millis) {
      return this.CHART_PAD_LEFT + Math.round((millis - this.chartStartTS) / this.scale);
   },


   handleTableHeightChange: function() {
      this.setLeftHeaderWidth();

      // expand the vertical date tick marks to match the table height
      var dateBarHeight = (this.elems.rightTable.offsetHeight + this.HEADER_HEIGHT - 1) + 'px';
      var dateDivs = this.elems.dateHolder.getElementsByTagName("div");
      for (var i = 0; i < dateDivs.length; i++) {
         var oneDiv = dateDivs[i];
         if (oneDiv.className == "tsGanttDateBar")
            oneDiv.style.height = dateBarHeight;
      }

      // update dependencies (hiding/showing/stretching) as appropriate
      for (var i = 0; i < this.dependencies.length;  i++)
         this.updateDependencyVertically(this.dependencies[i]);
   },

   setLeftHeaderWidth: function() {
      // expand the header on the left table to match the table width
      this.elems.leftHeader.style.width = this.elems.leftTable.offsetWidth + 'px';
   },

   updateDependencyVertically: function(dep) {
      var shouldHide = dep.firstRow.hidden || dep.secondRow.hidden
                 || !dep.firstRow.startTS || !dep.secondRow.startTS;
      if (shouldHide) {
         if (!dep.hidden) {
            Element.hide(dep.firstHolder);
            Element.hide(dep.secondHolder);
            dep.hidden = true;
         }
         return;
      }

      if (dep.needsInit)
         this.initDependency(dep);

      var firstRowY = dep.firstRow.rightTR.offsetTop;
      var secondRowY = dep.secondRow.rightTR.offsetTop;
      var mainVertLen = (Math.abs(firstRowY - secondRowY) - 13) + 'px'
      dep.lines[1].style.height = mainVertLen;
      dep.lines[2].style.height = mainVertLen;

      if (dep.needsScale && this.scale > 0)
         this.scaleDependency(dep);

      if (dep.hidden) {
         Element.show(dep.firstHolder);
         Element.show(dep.secondHolder);
         dep.hidden = false;
      }
   },

   rebuildDateLines: function(tableWidth) {
      this.elems.dateHolder.innerHTML = "";

      var dateBarHeight = (this.elems.rightTable.offsetHeight + this.HEADER_HEIGHT - 1) + 'px';

      var dateIter = this.getBestDateIterator(tableWidth);
      while (true) {
         var oneDateX = this.millisToPixels(dateIter.date.getTime());
         var oneDateLabel = dateIter.format();
         dateIter.next();

         if (oneDateX < 0) continue;
         if (oneDateX > tableWidth) break;

         var newLine = this.makeDiv("tsGanttDateBar", this.elems.dateHolder);
         newLine.style.left = oneDateX + 'px';
         newLine.style.height = dateBarHeight;

         if (oneDateX + 50 < tableWidth) {
            var newLabel = this.makeDiv("tsGanttDateLabel", this.elems.dateHolder);
            newLabel.style.left = oneDateX + 'px';
            newLabel.appendChild(document.createTextNode(oneDateLabel));
         }
      }
   },

   getBestDateIterator: function(tableWidth) {
      var minSpacing = Math.max(tableWidth / this.MAX_NUM_DATE_LINES, this.MIN_DATE_LINE_SPACING);
      var minIteratorWidth = minSpacing * this.scale;
      for (var i = TsGanttChartDateIterators.length - 1; i > 0;  i--) {
         var iterClass = TsGanttChartDateIterators[i];
         if (iterClass.prototype.milliWidth > minIteratorWidth)
            return new iterClass(this.chartStartTS, this.firstDayOfWeek);
      }
      var yearIter = new TsGanttChartDateIterators[0](this.chartStartTS, this.firstDayOfWeek);
      yearIter.adjustToMilliWidth(minIteratorWidth);
      return yearIter;
   },



   setHighlightedRow: function(newRow) {
      if (this.elems.highlightedRow === newRow)
         return;
      if (this.elems.highlightedRow) {
         Element.removeClassName(this.elems.highlightedRow.leftTR, "tsgHighlight");
         Element.removeClassName(this.elems.highlightedRow.rightTR, "tsgHighlight");
      }
      if (newRow) {
         Element.addClassName(newRow.leftTR, "tsgHighlight");
         Element.addClassName(newRow.rightTR, "tsgHighlight");
      }
      this.elems.highlightedRow = newRow;
   },

   mouseOverRow: function(event) {
      if (this.mouseOutTimer) {
         clearTimeout(this.mouseOutTimer);
         this.mouseOutTimer = null;
      }
      this.setHighlightedRow(this.getRowForEvent(event));
   },

   mouseOutTable: function(event) {
      if (!this.mouseOutTimer)
         this.mouseOutTimer = setTimeout(this.eventUnhighlightRow, 100);
   },

   unhighlightRow: function() {
      this.mouseOutTimer = null;
      this.setHighlightedRow(null);
   },

   mouseOverTask: function(event) {
      var chartRow = this.getRowForEvent(event);
      if (!chartRow) return;

      var tooltip = chartRow.tooltip;
      if (Element.childOf(Event.element(event), this.elems.rightTable))
         tooltip = tooltip + "<hr>Double-click to zoom in";

      overlib(tooltip, WIDTH, 300, DELAY, 500);
   },

   mouseOutTask:  function(event) {
      nd();
   },

   resizeLeft: function(event) {
      TsGanttChartResizeHandler.startDrag(event, this.elems.leftData, this.eventAfterColumnResize);
      return false;
   },

   resizeRight: function(event) {
      TsGanttChartResizeHandler.startDrag(event, this.elems.rightData, this.eventAfterColumnResize);
      return false;
   },

   afterColumnResize: function() {
      if (!this.scale) return;

      this.setLeftHeaderWidth();
      this.setRightTableAndHeaderWidth();
   },

   mouseDownTable: function(event) {
      var targetTable = Event.findElement(event, "table");
      if (!targetTable) return true;
      var scrollDiv = targetTable.parentNode;
      if (!scrollDiv) return true;

      TsGanttChartDragScrollHandler.startDrag(event, scrollDiv);
      return false;
   },

   doubleClickTask: function(event) {
      var chartRow = this.getRowForEvent(event);
      if (!chartRow) return;

      var clickedElem = Event.element(event);
      if (clickedElem == chartRow.bar || Element.childOf(clickedElem, chartRow.bar))
         this.scaleToRow(chartRow);
      else
         this.autoscale();

      Event.stop(event);
      return false;
   },

   showChartConfig: function(event) {
      var configButton = Event.element(event);
      var newWind = window.open (configButton.href, 'tsgCustomize',
            'scrollbars=yes,dependent=yes,resizable=yes,width=420,height=250');
      newWind.focus();

      return false;
   },


   getRowForEvent: function(event) {
      return this.getRowForRowNum(this.getRowNumForEvent(event));
   },

   getRowNumForEvent: function(event) {
      if (!event) return -1;
      var tableRow = Event.findElement(event, "tr");
      if (!tableRow) return -1;
      var id = tableRow.id;
      return parseInt(id.split('_').last());
   },

   getRowForRowNum: function(rowNum) {
      if (this.rows != null && rowNum >= 0 && rowNum < this.rows.length)
         return this.rows[rowNum];
      return null;
   },

   makeDiv: function(className, parent, prepend) {
      var result = document.createElement("div");
      result.className = className;
      if (parent) {
         if (prepend)
            parent.insertBefore(result, parent.firstChild);
         else
            parent.appendChild(result);
      }
      return result;
   },

   showElapsed: function(msg, start) {
      if (this.debug) {
         var end = new Date();
         var elapsed = end.getTime() - start.getTime();
         window.alert(msg + ", elapsed " + elapsed + " ms");
      }
   },


   CHART_PAD_LEFT: 25,
   LABEL_PAD_LEFT: 15,
   TD_BORDER_WIDTH: 2,
   BAR_BORDER_WIDTH: 1,
   HEADER_HEIGHT: 30,
   STD_LABEL_PAD: 50,
   DEP_HORIZ_WIDTH: 6,
   DEP_ARROW_WIDTH: 9,
   MAX_NUM_DATE_LINES: 200,
   MIN_DATE_LINE_SPACING: 125,
   ZOOM_FACTOR: 1.2,

   debug: false

};


var TsGanttDateUtils = {

   SECOND: 1000,
   MINUTE: 60 * 1000,
   HOUR: 60 * 60 * 1000,
   DAY: 24 * 60 * 60 * 1000,
   WEEK: 7 * 24 * 60 * 60 * 1000,
   MONTH: 30 * 24 * 60 * 60 * 1000,

   DST_FUDGE: 2 * 60 * 60 * 1000,

   trunc: function(date) {
      date.setHours(0, 0, 0, 0);
   },

   // this array is replaced at runtime with locale-specific values
   MONTH_NAMES: [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ],

   monthName: function(month) {
      if (month.getMonth) month = month.getMonth();
      return TsGanttDateUtils.MONTH_NAMES[month];
   }

};

var TsGanttChartDateIterators = [];


// Daily iterator
TsGanttChartDateIterators[7] = Class.create();
TsGanttChartDateIterators[7].prototype = {

   milliWidth: TsGanttDateUtils.DAY,

   increment: 1,

   initialize: function(timestamp, firstDayOfWeek) {
      this.date = new Date(timestamp);
      this.trunc(this.date);
   },

   format: function() {
      return this.date.getDate() + " " + this.monthName(this.date);
   },

   next: function() {
      var nextVal = new Date(this.date.getTime() + (this.DAY * this.increment) + this.DST_FUDGE);
      this.trunc(nextVal);
      this.date = nextVal;
   }
   
};


// Every-2-days iterator
TsGanttChartDateIterators[6] = Class.create();
Object.extend(TsGanttChartDateIterators[6].prototype, TsGanttChartDateIterators[7].prototype);
Object.extend(TsGanttChartDateIterators[6].prototype, {
   milliWidth: 2 * TsGanttDateUtils.DAY,
   increment: 2
});


// Weekly iterator
TsGanttChartDateIterators[5] = Class.create();
TsGanttChartDateIterators[5].prototype = {

   milliWidth: TsGanttDateUtils.WEEK,

   increment: 1,

   initialize: function(timestamp, firstDayOfWeek) {
      var d = new Date(timestamp);
      this.trunc(d);
      var dayOfWeek = d.getDay();
      var delta = firstDayOfWeek - dayOfWeek;
      if (delta != 0) {
          d.setTime(d.getTime() + (this.DAY * delta) + this.DST_FUDGE);
          this.trunc(d);
      }

      this.date = d;
   },

   format: function() {
      return this.date.getDate() + " " + this.monthName(this.date);
   },

   next: function() {
      var nextVal = new Date(this.date.getTime() + (this.increment * this.WEEK) + this.DST_FUDGE);
      this.trunc(nextVal);
      this.date = nextVal;
   }

};


// Two weeks iterator
TsGanttChartDateIterators[4] = Class.create();
Object.extend(TsGanttChartDateIterators[4].prototype, TsGanttChartDateIterators[5].prototype);
Object.extend(TsGanttChartDateIterators[4].prototype, {
   milliWidth: 2 * TsGanttDateUtils.WEEK,
   increment: 2
});


// Monthly iterator
TsGanttChartDateIterators[3] = Class.create();
TsGanttChartDateIterators[3].prototype = {

   milliWidth: TsGanttDateUtils.MONTH,

   increment: 1,

   initialize: function(timestamp, firstDayOfWeek) {
      var d = new Date(timestamp);
      this.month = Math.floor(d.getMonth() / this.increment) * this.increment;
      this.year = d.getFullYear();
      this.date = new Date(this.year, this.month, 1);
   },

   format: function() {
      return this.monthName(this.month) + " " + this.year;
   },

   next: function() {
      this.month = this.month + this.increment;
      if (this.month > 11) {
         this.month = this.month - 12;
         this.year = this.year + 1;
      }
      this.date = new Date(this.year, this.month, 1);
   }

};


// Quarterly iterator
TsGanttChartDateIterators[2] = Class.create();
Object.extend(TsGanttChartDateIterators[2].prototype, TsGanttChartDateIterators[3].prototype);
Object.extend(TsGanttChartDateIterators[2].prototype, {
   milliWidth: 3 * TsGanttDateUtils.MONTH,
   increment: 3
});


// Six-month iterator
TsGanttChartDateIterators[1] = Class.create();
Object.extend(TsGanttChartDateIterators[1].prototype, TsGanttChartDateIterators[3].prototype);
Object.extend(TsGanttChartDateIterators[1].prototype, {
   milliWidth: 6 * TsGanttDateUtils.MONTH,
   increment: 6
});


// Yearly iterator
TsGanttChartDateIterators[0] = Class.create();
TsGanttChartDateIterators[0].prototype = {

   milliWidth: 365 * TsGanttDateUtils.DAY,

   initialize: function(timestamp, firstDayOfWeek) {
      var d = new Date(timestamp);
      this.year = d.getFullYear();
      this.date = new Date(this.year, 0, 1);
   },

   adjustToMilliWidth: function(milliWidth) {
      this.yearDelta = Math.ceil(milliWidth / this.milliWidth);
   },

   format: function() {
      return this.year;
   },

   next: function() {
      this.year = this.year + this.yearDelta;
      this.date = new Date(this.year, 0, 1);
   }

};

for (var i = 0; i < TsGanttChartDateIterators.length;  i++) {
   Object.extend(TsGanttChartDateIterators[i].prototype, TsGanttDateUtils);
}
