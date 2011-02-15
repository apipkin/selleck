/*
Selleck
Copyright (c) 2011 Yahoo! Inc.
Licensed under the BSD License.
*/

var fs        = require('fs'),
    path      = require('path'),
    mustache  = require('mustache'),

    fileutils = require('./lib/fileutils'),
    util      = require('./lib/util'), // Selleck util, not Node util.

    View          = exports.View          = require('./lib/view'),
    ComponentView = exports.ComponentView = require('./lib/view/component');

/**
@property defaultTheme
@type {String}
**/
exports.defaultTheme = path.join(__dirname, 'themes', 'default');

/**
@method copyAssets
@param {String} inDir
@param {String} outDir
@param {bool} [deleteFirst=false]
@callback
  @param {Error} err
**/
function copyAssets() {
    var args        = Array.prototype.slice.call(arguments),
        callback    = args.pop(),
        inDir       = args.shift(),
        outDir      = args.shift(),
        deleteFirst = args.shift(),

        inAssets  = path.join(inDir, 'assets'),
        outAssets = path.join(outDir, 'assets');

    // If the input directory contains an "assets" subdirectory, copy it to the
    // output directory.
    if (fileutils.isDirectory(inAssets)) {
        if (deleteFirst && fileutils.isDirectory(outAssets)) {
            fileutils.deletePath(outAssets);
        }

        fileutils.copyPath(inAssets, outAssets, true, callback);
    } else {
        callback();
    }
}
exports.copyAssets = copyAssets;

/**
@method createOutputDir
**/
function createOutputDir(outDir) {
    var stats = fileutils.statSync(outDir);

    if (stats) {
        if (!stats.isDirectory()) {
            throw new Error('Output path already exists and is not a directory: ' + outDir);
        }
    } else {
        // TODO: mkdir -p
        fs.mkdirSync(outDir, 0755);
    }
}
exports.createOutputDir = createOutputDir;

/**
@method findDocs
@return {Object}
**/
function findDocs(dir, docs) {
    docs || (docs = {components: []});

    if (!fileutils.isDirectory(dir)) {
        log('Not a directory: ' + dir, 'error');
        return docs;
    }

    if (isComponentDirectory(dir)) {
        docs.components.push({path: dir});
    } else if (isProjectDirectory(dir)) {
        if (docs.project) {
            log('Multiple projects found; ignoring ' + dir, 'warn');
        } else {
            docs.project = {path: dir};
        }
    } else {
        fs.readdirSync(dir).forEach(function (filename) {
            var filePath = path.join(dir, filename);

            // Skip hidden files and directories.
            if (filename.indexOf('.') === 0) { return; }

            if (fileutils.isDirectory(filePath)) {
                findDocs(filePath, docs);
            }
        });
    }

    return docs;
}
exports.findDocs = findDocs;

/**
@method generate
**/
function generate(inDir, outDir, options) {
    var layout, pageName, view;

    if (options && options.skipLoad) {
        // Skip loading layouts, metadata, pages, and partials and assume that
        // the caller has provided them if they want them.
        options = util.merge({
            layouts  : {},
            meta     : {},
            pages    : {},
            partials : {},
            viewClass: options.component ? ComponentView : View
        }, options);
    } else {
        // Gather layouts, metadata, pages, and partials from the specified
        // input directory, then merge them into the provided options (if any).
        //
        // Gathered data will override provided data if there are conflicts, in
        // order to support a use case where global data are provided by the
        // caller and overridden by more specific component-level data gathered
        // from the input directory.
        options = util.merge({
            viewClass: options.component ? ComponentView : View
        }, options || {}, {
            layouts : getLayouts(inDir),
            meta    : getMetadata(inDir, options.component ? 'component' : 'project'),
            pages   : getPages(inDir),
            partials: getPartials(inDir)
        });
    }

    // If a validator function was provided, run it, and skip the generation
    // step if it returns false.
    if (options.validator && options.validator(options, inDir) === false) {
        return false;
    }

    // Append meta.name to the output path if this is a component.
    if (options.component) {
        outDir = path.join(outDir, options.meta.name);
    }

    createOutputDir(outDir);
    copyAssets(inDir, outDir, function () {});

    if (options.component) {
        layout = options.layouts.component || options.layouts.main;
    } else {
        layout = options.layouts.main;
    }

    // Render each page to HTML and write it to the output directory.
    for (pageName in options.pages) {
        view = new options.viewClass(options.meta, {layout: layout});

        fs.writeFileSync(path.join(outDir, pageName + '.html'),
                render(options.pages[pageName], view, options.partials));
    }

    return true;
}
exports.generate = generate;

/**
@method getMetadata
**/
function getMetadata(dir, type) {
    var filePath = path.join(dir, type + '.json'),
        json, meta;

    if (fileutils.isFile(filePath)) {
        json = fs.readFileSync(filePath, 'utf8');

        try {
            meta = JSON.parse(json);
        } catch (ex) {
            log(filePath + ': JSON error: ' + ex.message, 'error');
        }
    }

    return meta || {};
}
exports.getMetadata = getMetadata;

/**
Like `getPages()`, but returns only the files under the `layout/` subdirectory
of the specified _dir_.

@method getLayouts
@param {String} dir Directory path.
@return {Object} Mapping of layout names to layout content.
**/
function getLayouts(dir) {
    return getPages(path.join(dir, 'layout'));
}
exports.getLayouts = getLayouts;

/**
Loads and returns the content of the specified page file.

@method getPage
@param {String} pagePath Path to a single `.mustache` page.
@return {String|null} Page content, or `null` if not found.
**/
function getPage(pagePath) {
    if (!fileutils.isFile(pagePath)) { return null; }
    return fs.readFileSync(pagePath, 'utf8');
}
exports.getPage = getPage;

/**
Loads pages (files with a .mustache extension) in the specified directory and
returns an object containing a mapping of page names (the part of the filename)
preceding the .mustache extension) to page content.

@method getPages
@param {String} dir Directory path.
@return {Object} Mapping of page names to page content.
**/
function getPages(dir) {
    var pages = {};

    if (!fileutils.isDirectory(dir)) { return pages; }

    fs.readdirSync(dir).forEach(function (filename) {
        var filePath = path.join(dir, filename);

        if (path.extname(filename) === '.mustache' && fileutils.isFile(filePath)) {
            pages[path.basename(filename, '.mustache')] = fs.readFileSync(filePath, 'utf8');
        }
    });

    return pages;
}
exports.getPages = getPages;

/**
Like `getPages()`, but returns only the files under the `partial/` subdirectory
of the specified _dir_.

@method getPartials
@param {String} dir Directory path.
@return {Object} Mapping of partial names to partial content.
**/
function getPartials(dir) {
    return getPages(path.join(dir, 'partial'));
}
exports.getPartials = getPartials;

/**
@method isComponentDirectory
**/
function isComponentDirectory(dir) {
    var metaStats, indexStats;

    try {
        metaStats  = fs.statSync(path.join(dir, 'component.json'));
        indexStats = fs.statSync(path.join(dir, 'index.mustache'));
    } catch (ex) {
        return false;
    }

    return metaStats.isFile() && indexStats.isFile();
}
exports.isComponentDirectory = isComponentDirectory;

/**
@method isProjectDirectory
**/
function isProjectDirectory(dir) {
    var metaStats, indexStats;

    try {
        metaStats  = fs.statSync(path.join(dir, 'project.json'));
        indexStats = fs.statSync(path.join(dir, 'index.mustache'));
    } catch (ex) {
        return false;
    }

    return metaStats.isFile() && indexStats.isFile();
}
exports.isProjectDirectory = isProjectDirectory;

/**
@method log
**/
function log(message, level) {
    console.log('[' + (level || 'info') + '] ' + message);
}
exports.log = log;

/**
@method render
**/
function render(content, view, partials) {
    var html = [];

    function sendFunction(line) {
        html.push(line);
    }

    if (view.layout) {
        mustache.to_html(view.layout, view,
                util.merge(partials || {}, {layout_content: content}),
                sendFunction);
    } else {
        mustache.to_html(content, view, partials || {}, sendFunction);
    }

    return renderTableOfContents(html.join('\n'), view._toc);
}
exports.render = render;

/**
@method renderTableOfContents
**/
function renderTableOfContents(html, headings) {
    var listHtml;

    // Nothing to do if html doesn't contain a TOC placeholder.
    if (html.indexOf(View.TOC_PLACEHOLDER_TEXT) === -1) {
        return html;
    }

    // Generate a list.
    listHtml = renderTableOfContentsList(headings);

    // Replace the placeholder text with the generated list.
    return html.replace(View.TOC_PLACEHOLDER_TEXT, listHtml);
}
exports.renderTableOfContents = renderTableOfContents;

// -- Private Functions --------------------------------------------------------
function renderTableOfContentsList(heading) {
    var listHtml = [];

    listHtml.push('<ul class="toc">');

    heading.headings.forEach(function (child) {
        listHtml.push('<li>');
        listHtml.push('<a href="#' + child.name + '">' + child.html + '</a>');

        if (child.headings.length) {
            listHtml.push(renderTableOfContentsList(child));
        }

        listHtml.push('</li>');
    });

    listHtml.push('</ul>');

    return listHtml.join('\n');
}
