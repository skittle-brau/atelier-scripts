/*
    Export_CMYK_brand_assets.jsx
    ---------------------------------------------------------------
    Adobe Illustrator script (ExtendScript)

    Exports every artboard in the active document as its own
    .ai, .pdf and .eps file. You choose the destination folder.

    For each exported file:
    - Only that artboard and the artwork on it are included.
    - All linked images are embedded.
    - All text is converted to outlines (no fonts needed downstream).
    - All appearances are expanded and all strokes are outlined,
      so strokes become filled shapes.
    - PDF is saved as PDF/X-4:2008.
    - EPS includes a colour TIFF preview.
    - If the document is RGB, you're offered the option to convert
      the exports to CMYK.

    Files are named after the artboard with "-cmyk" added
    (e.g. "Logo_Primary-cmyk.ai").
    If two artboards share a name, " (2)", " (3)" etc. is added.

    After choosing the destination you're asked whether to save each
    format into its own subfolder (AI, PDF and EPS).

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
    var SCRIPT_NAME = "Export CMYK Brand Assets";
    var PDF_PRESET = "[PDF/X-4:2008]";
    var EXTENSIONS = ["ai", "pdf", "eps"];
    var FILE_SUFFIX = "-cmyk"; // added to every file name, e.g. "Logo_Primary-cmyk.pdf"

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

    var convertToCmyk = false;
    if (srcDoc.documentColorSpace !== DocumentColorSpace.CMYK) {
        convertToCmyk = confirm(
            "This document is in RGB colour mode.\n\n" +
            "Convert the exported files to CMYK?\n" +
            "(Your original document won't be changed. Choose No to export in RGB.)",
            false, SCRIPT_NAME
        );
    }

    var destFolder = Folder.selectDialog("Choose a destination folder for the exported artboards");
    if (!destFolder) return; // user cancelled

    var useSubfolders = confirm(
        "Save each file format into its own subfolder?\n\n" +
        "Yes: files go into AI, PDF and EPS subfolders inside the destination.\n" +
        "No: all files go straight into the destination folder.",
        true, SCRIPT_NAME
    );

    // ---------- Work out file names --------------------------------

    var boardNames = [];
    var used = {};
    for (var i = 0; i < srcDoc.artboards.length; i++) {
        var base = sanitizeFileName(srcDoc.artboards[i].name);
        if (base === "") base = "Artboard " + (i + 1);
        var name = base;
        var n = 2;
        while (used[name.toLowerCase()]) {
            name = base + " (" + n + ")";
            n++;
        }
        used[name.toLowerCase()] = true;
        boardNames.push(name);
    }

    // Warn once if any files would be overwritten.
    var clashes = 0;
    for (i = 0; i < boardNames.length; i++) {
        for (var e = 0; e < EXTENSIONS.length; e++) {
            if (outFile(destFolder, boardNames[i], EXTENSIONS[e]).exists) clashes++;
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
    var tempFile = new File(Folder.temp.fsName + "/ecba_" + new Date().getTime() + "." + ext);
    if (!srcFile.copy(tempFile.fsName)) {
        alert("Couldn't create a temporary working copy of the document.\n\n" + srcFile.error, SCRIPT_NAME);
        return;
    }

    // ---------- Export loop ---------------------------------------

    var prevInteraction = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

    var progress = makeProgress(boardNames.length);
    var errors = [];
    var warnings = [];
    var exported = 0;

    try {
        for (i = 0; i < boardNames.length; i++) {
            progress.set(i, "Exporting " + (i + 1) + " of " + boardNames.length + ": " + boardNames[i]);

            var work = null;
            try {
                work = app.open(tempFile);
                var issues = prepareArtboard(work, i, convertToCmyk);
                for (var w = 0; w < issues.length; w++) warnings.push(boardNames[i] + ": " + issues[w]);

                work.saveAs(outFile(destFolder, boardNames[i], "ai", true), aiOptions());
                work.saveAs(outFile(destFolder, boardNames[i], "pdf", true), pdfOptions(pdfPresetFound));
                work.saveAs(outFile(destFolder, boardNames[i], "eps", true), epsOptions());

                exported++;
            } catch (err) {
                errors.push(boardNames[i] + ": " + err.message);
            } finally {
                if (work) {
                    try { work.close(SaveOptions.DONOTSAVECHANGES); } catch (closeErr) {}
                }
            }
        }
        progress.set(boardNames.length, "Done");
    } finally {
        app.userInteractionLevel = prevInteraction;
        progress.close();
        try { tempFile.remove(); } catch (rmErr) {}
        try { srcDoc.activate(); } catch (actErr) {}
    }

    // ---------- Report ---------------------------------------------

    var msg = "Exported " + exported + " of " + boardNames.length + " artboard(s) as AI, PDF and EPS to:\n" +
              destFolder.fsName;
    if (!pdfPresetFound) {
        msg += "\n\nNote: the " + PDF_PRESET + " preset wasn't found, so the PDF/X-4 standard " +
               "was applied directly. Check the output intent in the PDFs.";
    }
    if (convertToCmyk) msg += "\n\nExports were converted from RGB to CMYK.";
    if (warnings.length) msg += "\n\nWarnings:\n- " + warnings.join("\n- ");
    if (errors.length) msg += "\n\nErrors:\n- " + errors.join("\n- ");
    msg += "\n\nOpen the destination folder?";

    if (confirm(msg, false, SCRIPT_NAME)) destFolder.execute();

    // ==============================================================
    // Helpers
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

    function aiOptions() {
        var o = new IllustratorSaveOptions();
        o.pdfCompatible = true;
        o.embedLinkedFiles = true;
        o.embedICCProfile = true;
        o.compressed = true;
        o.saveMultipleArtboards = false;
        return o;
    }

    function pdfOptions(usePreset) {
        var o = new PDFSaveOptions();
        if (usePreset) {
            // The built-in preset already sets PDF/X-4:2008, PDF 1.6 and the output intent.
            o.pDFPreset = PDF_PRESET;
        } else {
            // Fallback if the preset isn't installed. Note: Illustrator's scripting
            // name for PDF/X-4:2008 is PDFX42007. Referencing an enum value that
            // doesn't exist throws "Invalid enumeration value", hence the try.
            try {
                o.compatibility = PDFCompatibility.ACROBAT7;
                o.pDFXStandard = PDFXStandard.PDFX42007;
            } catch (enumErr) {}
        }
        o.viewAfterSaving = false;
        return o;
    }

    function epsOptions() {
        var o = new EPSSaveOptions();
        o.preview = EPSPreview.COLORTIFF;
        o.includeDocumentThumbnails = true;
        o.embedLinkedFiles = true;
        o.cmykPostScript = true;
        o.postScript = EPSPostScriptLevelEnum.LEVEL3;
        o.saveMultipleArtboards = false;
        return o;
    }

    // Reduce the working copy to one artboard, embed images, outline text.
    // Returns a list of warnings.
    function prepareArtboard(d, keepIndex, toCmyk) {
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

        // 4. Expand appearances (effects, brushes, multiple fills/strokes),
        //    then outline all strokes so they become filled shapes.
        //    Runs after text outlining so strokes on text are caught too.
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

        // 6. Optional RGB -> CMYK conversion.
        if (toCmyk && d.documentColorSpace !== DocumentColorSpace.CMYK) {
            try {
                d.activate();
                app.executeMenuCommand("doc-color-cmyk");
            } catch (cmykErr) {
                issues.push("couldn't convert to CMYK");
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
