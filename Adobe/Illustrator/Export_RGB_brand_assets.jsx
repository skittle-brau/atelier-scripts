/*
    Export_RGB_brand_assets.jsx
    ---------------------------------------------------------------
    Adobe Illustrator script (ExtendScript)

    Exports every artboard in the active document as its own
    .ai, .png, .jpg, .pdf and .svg file. You choose the destination
    folder.

    For each exported file:
    - Only that artboard and the artwork on it are included.
    - All linked images are embedded.
    - All text is converted to outlines (no fonts needed downstream).
    - All appearances are expanded and all strokes are outlined,
      so strokes become filled shapes.
    - If the document is CMYK, you're offered the option to convert
      the exports to RGB.

    Formats:
    - AI  : PDF-compatible, linked files embedded.
    - PNG : transparent background, 3000 px on the longest edge.
    - JPG : white background, maximum quality, 3000 px on the longest edge.
            SKIPPED for any artboard whose name contains "rvd"
            (reversed artwork would be invisible on white).
    - PDF : PDF/X-4:2008 (no colour conversion, live transparency).
    - SVG : SVG 1.1, UTF-8, images embedded.

    Files are named after the artboard with "-rgb" added
    (e.g. "Logo_Primary-rgb.png"). If two artboards share a name,
    " (2)", " (3)" etc. is added.

    After choosing the destination you're asked whether to save each
    format into its own subfolder (AI, PNG, JPG, PDF and SVG).

    Your original document is never modified. The script works on
    a temporary copy that it deletes when it's done.

    Install: copy this file to Illustrator's Presets/<language>/Scripts
    folder and restart Illustrator. It will then appear under
    File > Scripts. You can also run it any time with File > Scripts >
    Other Script…
    ---------------------------------------------------------------
*/

#target illustrator

(function () {
    var SCRIPT_NAME = "Export RGB Brand Assets";
    var FILE_SUFFIX = "-rgb";             // added to every file name
    var PDF_PRESET = "[PDF/X-4:2008]";
    var RASTER_LONG_EDGE_PX = 3000;       // PNG/JPG size: pixels on the longest edge
    var JPG_SKIP_PATTERN = /rvd/i;        // artboard names matching this get no JPG

    // ---------- Pre-flight ----------------------------------------

    if (app.documents.length === 0) {
        alert("Please open a document before running this script.", SCRIPT_NAME);
        return;
    }

    var srcDoc = app.activeDocument;
    var srcFile = null;
    try { srcFile = srcDoc.fullName; } catch (e) { srcFile = null; }

    if (!srcFile || !srcFile.exists) {
        alert("Please save this document at least once before exporting.", SCRIPT_NAME);
        return;
    }

    if (!srcDoc.saved) {
        var saveNow = confirm(
            "This document has unsaved changes.\n\n" +
            "Save it now so the exports include them?\n" +
            "(Choose No to cancel the export.)",
            false, SCRIPT_NAME
        );
        if (!saveNow) return;
        srcDoc.save();
    }

    var convertToRgb = false;
    if (srcDoc.documentColorSpace !== DocumentColorSpace.RGB) {
        convertToRgb = confirm(
            "This document is in CMYK colour mode.\n\n" +
            "Convert the exported files to RGB?\n" +
            "(Your original document won't be changed. Choose No to export in CMYK.)",
            false, SCRIPT_NAME
        );
    }

    var destFolder = Folder.selectDialog("Choose a destination folder for the exported artboards");
    if (!destFolder) return; // user cancelled

    var useSubfolders = confirm(
        "Save each file format into its own subfolder?\n\n" +
        "Yes: files go into AI, PNG, JPG, PDF and SVG subfolders inside the destination.\n" +
        "No: all files go straight into the destination folder.",
        true, SCRIPT_NAME
    );

    // ---------- Work out file names and formats -------------------

    var boards = []; // { name: fileBaseName, formats: [...] }
    var used = {};
    for (var i = 0; i < srcDoc.artboards.length; i++) {
        var abName = srcDoc.artboards[i].name;
        var base = sanitizeFileName(abName);
        if (base === "") base = "Artboard " + (i + 1);
        var name = base;
        var n = 2;
        while (used[name.toLowerCase()]) {
            name = base + " (" + n + ")";
            n++;
        }
        used[name.toLowerCase()] = true;

        // Vector formats first: the raster step rescales the working copy.
        var formats = ["ai", "pdf", "svg", "png", "jpg"];
        if (JPG_SKIP_PATTERN.test(abName)) formats = ["ai", "pdf", "svg", "png"];

        boards.push({ name: name, formats: formats });
    }

    // Warn once if any files would be overwritten.
    var clashes = 0;
    for (i = 0; i < boards.length; i++) {
        for (var f = 0; f < boards[i].formats.length; f++) {
            if (outFile(destFolder, boards[i].name, boards[i].formats[f]).exists) clashes++;
        }
    }
    if (clashes > 0) {
        var overwrite = confirm(
            clashes + " file(s) with the same names already exist in:\n" +
            destFolder.fsName + "\n\nOverwrite them?",
            true, SCRIPT_NAME
        );
        if (!overwrite) return;
    }

    var pdfPresetFound = hasPdfPreset(PDF_PRESET);

    // ---------- Temporary working copy ----------------------------

    var ext = srcFile.name.replace(/^.*\./, "");
    var tempFile = new File(Folder.temp.fsName + "/erba_" + new Date().getTime() + "." + ext);
    if (!srcFile.copy(tempFile.fsName)) {
        alert("Couldn't create a temporary working copy of the document.\n\n" + srcFile.error, SCRIPT_NAME);
        return;
    }

    // ---------- Export loop ---------------------------------------

    var prevInteraction = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

    var progress = makeProgress(boards.length);
    var errors = [];
    var warnings = [];
    var exported = 0;
    var skippedJpg = 0;

    try {
        for (i = 0; i < boards.length; i++) {
            var b = boards[i];
            progress.set(i, "Exporting " + (i + 1) + " of " + boards.length + ": " + b.name);

            var work = null;
            try {
                work = app.open(tempFile);
                var issues = prepareArtboard(work, i, convertToRgb);
                for (var w = 0; w < issues.length; w++) warnings.push(b.name + ": " + issues[w]);

                // Each format is tried separately so one failure doesn't block the rest.
                var boardFailed = false;
                var rasterReady = false;
                for (f = 0; f < b.formats.length; f++) {
                    var fmt = b.formats[f];
                    try {
                        if ((fmt === "png" || fmt === "jpg") && !rasterReady) {
                            scaleForRaster(work, RASTER_LONG_EDGE_PX);
                            rasterReady = true;
                        }
                        exportFormat(work, fmt, outFile(destFolder, b.name, fmt, true));
                    } catch (fmtErr) {
                        errors.push(b.name + " (" + fmt.toUpperCase() + "): " + fmtErr.message);
                        boardFailed = true;
                    }
                }
                if (!boardFailed) exported++;
                if (b.formats.length === 4) skippedJpg++;
            } catch (err) {
                errors.push(b.name + ": " + err.message);
            } finally {
                if (work) {
                    try { work.close(SaveOptions.DONOTSAVECHANGES); } catch (closeErr) {}
                }
            }
        }
        progress.set(boards.length, "Done");
    } finally {
        app.userInteractionLevel = prevInteraction;
        progress.close();
        try { tempFile.remove(); } catch (rmErr) {}
        try { srcDoc.activate(); } catch (actErr) {}
    }

    // ---------- Report ---------------------------------------------

    var msg = "Exported " + exported + " of " + boards.length + " artboard(s) to:\n" + destFolder.fsName;
    if (skippedJpg) msg += "\n\nJPG skipped for " + skippedJpg + " artboard(s) with \"rvd\" in the name.";
    if (!pdfPresetFound) msg += "\n\nNote: the " + PDF_PRESET + " preset wasn't found, so the PDF/X-4 standard " +
                                "was applied directly. Check the output intent in the PDFs.";
    if (convertToRgb) msg += "\n\nExports were converted from CMYK to RGB.";
    if (warnings.length) msg += "\n\nWarnings:\n- " + warnings.join("\n- ");
    if (errors.length) msg += "\n\nErrors:\n- " + errors.join("\n- ");
    msg += "\n\nOpen the destination folder?";

    if (confirm(msg, false, SCRIPT_NAME)) destFolder.execute();

    // ==============================================================
    // Export helpers
    // ==============================================================

    // Formats are processed in the order ai, pdf, svg, png, jpg.
    // saveAs (ai, pdf) re-points the open document at the new file;
    // that's harmless here because the copy is closed without saving.
    function exportFormat(d, fmt, file) {
        switch (fmt) {
            case "ai":  d.saveAs(file, aiOptions()); break;
            case "pdf": d.saveAs(file, pdfOptions()); break;
            case "png": d.exportFile(file, ExportType.PNG24, pngOptions()); break;
            case "jpg": d.exportFile(file, ExportType.JPEG, jpgOptions()); break;
            case "svg": d.exportFile(file, ExportType.SVG, svgOptions()); break;
        }
    }

    // Sets an option without letting an unsupported property or enum
    // (which differ between Illustrator versions) stop the export.
    function setOpt(o, prop, getValue) {
        try { o[prop] = getValue(); } catch (e) {}
    }

    function aiOptions() {
        var o = new IllustratorSaveOptions();
        setOpt(o, "pdfCompatible", function () { return true; });
        setOpt(o, "embedLinkedFiles", function () { return true; });
        setOpt(o, "embedICCProfile", function () { return true; });
        setOpt(o, "compressed", function () { return true; });
        setOpt(o, "saveMultipleArtboards", function () { return false; });
        return o;
    }

    function pdfOptions() {
        var o = new PDFSaveOptions();
        if (pdfPresetFound) {
            setOpt(o, "pDFPreset", function () { return PDF_PRESET; });
        } else {
            // Fallback if the preset isn't installed. Illustrator's scripting
            // name for PDF/X-4:2008 is PDFX42007.
            setOpt(o, "compatibility", function () { return PDFCompatibility.ACROBAT7; });
            setOpt(o, "pDFXStandard", function () { return PDFXStandard.PDFX42007; });
        }
        setOpt(o, "viewAfterSaving", function () { return false; });
        return o;
    }

    function pngOptions() {
        var o = new ExportOptionsPNG24();
        setOpt(o, "artBoardClipping", function () { return true; });
        setOpt(o, "transparency", function () { return true; });
        setOpt(o, "antiAliasing", function () { return true; });
        setOpt(o, "horizontalScale", function () { return 100; });
        setOpt(o, "verticalScale", function () { return 100; });
        setOpt(o, "saveAsHTML", function () { return false; });
        return o;
    }

    function jpgOptions() {
        var o = new ExportOptionsJPEG();
        setOpt(o, "artBoardClipping", function () { return true; });
        setOpt(o, "qualitySetting", function () { return 100; });
        setOpt(o, "antiAliasing", function () { return true; });
        setOpt(o, "optimization", function () { return true; });
        setOpt(o, "horizontalScale", function () { return 100; });
        setOpt(o, "verticalScale", function () { return 100; });
        setOpt(o, "saveAsHTML", function () { return false; });
        return o;
    }

    function svgOptions() {
        var o = new ExportOptionsSVG();
        setOpt(o, "embedRasterImages", function () { return true; });
        setOpt(o, "fontType", function () { return SVGFontType.OUTLINEFONT; });
        setOpt(o, "documentEncoding", function () { return SVGDocumentEncoding.UTF8; });
        setOpt(o, "DTD", function () { return SVGDTDVersion.SVG1_1; });
        setOpt(o, "cssProperties", function () { return SVGCSSPropertyLocation.STYLEATTRIBUTES; });
        setOpt(o, "coordinatePrecision", function () { return 3; });
        setOpt(o, "preserveEditability", function () { return false; });
        setOpt(o, "saveMultipleArtboards", function () { return false; });
        return o;
    }

    // Scales the working copy (artwork and artboard) so the artboard's
    // longest edge is targetPx points. Exporting at 100% (72 ppi) then
    // gives exactly targetPx pixels, with no limit from Illustrator's
    // maximum export scale. Only used after the vector formats are saved.
    function scaleForRaster(d, targetPx) {
        var ab = d.artboards[0];
        var r = ab.artboardRect; // [left, top, right, bottom]
        var w = r[2] - r[0];
        var h = r[1] - r[3];
        var pct = targetPx / Math.max(w, h) * 100;
        if (Math.abs(pct - 100) < 0.0001) return;

        // Unlock visible layers so their artwork can be selected.
        // Hidden layers are left alone: they don't render anyway.
        var states = [];
        unlockVisibleLayers(d.layers, states);

        try {
            var host = firstEditableLayer(d.layers);
            if (!host) return; // nothing visible to export

            // Invisible marker matching the artboard, scaled with the
            // artwork so the new artboard lines up exactly.
            var marker = host.pathItems.rectangle(r[1], r[0], w, h);
            marker.filled = false;
            marker.stroked = false;

            d.activate();
            d.selection = null;
            app.executeMenuCommand("selectall");
            app.executeMenuCommand("group");
            var g = d.selection.length ? d.selection[0] : null;
            if (!g || g.typename !== "GroupItem") throw new Error("couldn't group artwork for scaling");

            g.resize(pct, pct, true, true, true, true, pct, Transformation.TOPLEFT);
            ab.artboardRect = marker.geometricBounds;
            d.selection = null;
        } finally {
            for (var s = states.length - 1; s >= 0; s--) {
                try { states[s].layer.locked = states[s].locked; } catch (e) {}
            }
        }
    }

    function unlockVisibleLayers(layers, states) {
        for (var k = 0; k < layers.length; k++) {
            var L = layers[k];
            if (!L.visible) continue;
            states.push({ layer: L, locked: L.locked });
            L.locked = false;
            unlockVisibleLayers(L.layers, states);
        }
    }

    function firstEditableLayer(layers) {
        for (var k = 0; k < layers.length; k++) {
            if (layers[k].visible && !layers[k].locked) return layers[k];
        }
        return null;
    }

    // ==============================================================
    // General helpers
    // ==============================================================

    // Builds the output path. Pass create = true to make the format
    // subfolder (e.g. "PDF") if it doesn't exist yet.
    function outFile(folder, baseName, extension, create) {
        var dir = folder;
        if (useSubfolders) {
            dir = new Folder(folder.fsName + "/" + extension.toUpperCase());
            if (create && !dir.exists && !dir.create()) {
                throw new Error("couldn't create folder " + dir.fsName);
            }
        }
        return new File(dir.fsName + "/" + baseName + FILE_SUFFIX + "." + extension);
    }

    function sanitizeFileName(s) {
        return String(s)
            .replace(/[\\\/:\*\?"<>\|]/g, "-")   // characters not allowed in file names
            .replace(/^\s+|\s+$/g, "")           // trim
            .replace(/\.+$/, "");                // no trailing dots
    }

    function hasPdfPreset(presetName) {
        var list = app.PDFPresetsList;
        for (var q = 0; q < list.length; q++) {
            if (list[q] === presetName) return true;
        }
        return false;
    }

    // Reduce the working copy to one artboard, embed images, outline text,
    // expand appearances and strokes. Returns a list of warnings.
    function prepareArtboard(d, keepIndex, toRgb) {
        var issues = [];
        var rect = d.artboards[keepIndex].artboardRect; // [left, top, right, bottom]

        // Temporarily unlock and show every layer so items can be edited.
        var states = [];
        unlockLayers(d.layers, states);

        // 1. Remove artwork that doesn't touch this artboard.
        for (var l = 0; l < d.layers.length; l++) trimLayer(d.layers[l], rect);

        // 2. Embed all linked images.
        var failedEmbeds = 0;
        for (var p = d.placedItems.length - 1; p >= 0; p--) {
            try {
                var placed = d.placedItems[p];
                placed.locked = false;
                placed.embed();
            } catch (embedErr) {
                failedEmbeds++;
            }
        }
        if (failedEmbeds) issues.push(failedEmbeds + " linked image(s) couldn't be embedded (missing or broken links?)");

        // 3. Convert all text to outlines.
        for (var t = d.textFrames.length - 1; t >= 0; t--) {
            try {
                var tf = d.textFrames[t];
                tf.locked = false;
                tf.createOutline();
            } catch (outlineErr) {}
        }
        if (d.textFrames.length > 0) issues.push(d.textFrames.length + " text object(s) couldn't be outlined");

        // 4. Expand appearances, then outline all strokes.
        try {
            d.activate();
            app.executeMenuCommand("unlockAll");      // Object > Unlock All
            d.selection = null;
            app.executeMenuCommand("selectall");      // Select > All
            app.executeMenuCommand("expandStyle");    // Object > Expand Appearance
            app.executeMenuCommand("selectall");
            app.executeMenuCommand("OffsetPath v22"); // Object > Path > Outline Stroke
            d.selection = null;
        } catch (expandErr) {
            issues.push("couldn't expand appearances/strokes (" + expandErr.message + ")");
        }
        var leftStrokes = countVisibleStrokes(d);
        if (leftStrokes > 0) issues.push(leftStrokes + " stroked path(s) remain (e.g. hidden objects or inside symbols)");

        // Restore layer states, children first so locked parents don't block them.
        for (var s = states.length - 1; s >= 0; s--) {
            try {
                states[s].layer.visible = states[s].visible;
                states[s].layer.locked = states[s].locked;
            } catch (stateErr) {}
        }

        // 5. Remove every other artboard (from the end so indexes stay valid).
        for (var j = d.artboards.length - 1; j >= 0; j--) {
            if (j !== keepIndex) d.artboards[j].remove();
        }
        d.artboards.setActiveArtboardIndex(0);

        // 6. Optional CMYK -> RGB conversion.
        if (toRgb && d.documentColorSpace !== DocumentColorSpace.RGB) {
            try {
                d.activate();
                app.executeMenuCommand("doc-color-rgb");
            } catch (rgbErr) {
                issues.push("couldn't convert to RGB");
            }
        }

        return issues;
    }

    function countVisibleStrokes(d) {
        var count = 0;
        for (var k = 0; k < d.pathItems.length; k++) {
            try {
                var p = d.pathItems[k];
                if (p.stroked && !p.guides && !p.clipping && !p.hidden) count++;
            } catch (pErr) {}
        }
        return count;
    }

    function unlockLayers(layers, states) {
        for (var k = 0; k < layers.length; k++) {
            var L = layers[k];
            states.push({ layer: L, locked: L.locked, visible: L.visible });
            L.visible = true;
            L.locked = false;
            unlockLayers(L.layers, states);
        }
    }

    function trimLayer(layer, rect) {
        // Only top-level items in a layer are tested, so groups and
        // clipping masks that cross the artboard stay intact.
        for (var k = layer.pageItems.length - 1; k >= 0; k--) {
            var item;
            try { item = layer.pageItems[k]; } catch (idxErr) { continue; }
            try {
                if (item.parent.typename !== "Layer") continue;
                if (!intersects(item.visibleBounds, rect)) {
                    item.locked = false;
                    item.remove();
                }
            } catch (itemErr) {
                // Leave anything that can't be measured or removed.
            }
        }
        for (var s = 0; s < layer.layers.length; s++) trimLayer(layer.layers[s], rect);
    }

    // Bounds are [left, top, right, bottom]; y increases upwards.
    function intersects(b, r) {
        return !(b[2] < r[0] || b[0] > r[2] || b[1] < r[3] || b[3] > r[1]);
    }

    function makeProgress(total) {
        var w = new Window("palette", SCRIPT_NAME);
        w.alignChildren = "fill";
        var label = w.add("statictext", undefined, "Preparing…");
        label.preferredSize = [380, 20];
        var bar = w.add("progressbar", undefined, 0, Math.max(total, 1));
        bar.preferredSize = [380, 12];
        w.show();
        return {
            set: function (value, text) {
                bar.value = value;
                label.text = text;
                try { w.update(); } catch (uErr) {}
            },
            close: function () {
                try { w.close(); } catch (cErr) {}
            }
        };
    }
})();
