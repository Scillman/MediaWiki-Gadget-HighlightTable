/** <pre>
 * highlightTable.js
 *
 * Description:
 * Adds highlighting to tables
 *
 * History:
 * - 1.0: Row highlighting                         - Quarenon
 * - 1.1: Update from pengLocations.js v1.0        - Quarenon
 * - 2.0: pengLocations v2.1, Granular cookie      - Saftzie
 * - 2.1: Made compatible with jquery.tablesorter  - Cqm
 * - 2.2: Switch to localStorage                   - Cqm
 * - 3.0: Allow cell highlighting                  - mejrs
 * - 3.1: Ensure run order in combination with autosort - Mr Dew
 * - 4.0: Labelled highlighting, not page-specific - Joeytje50
 *
 * @todo Allow the stored data to be coupled to the table in question. Currently the data is stored
 *       on the page itself, so if any tables are shuffled, the highlighting doesn't follow. For
 *       the same reason tables hosted on other pages are not synchronized.
 */

/**
 * DATA STORAGE STRUCTURE
 * ----------------------
 *
 * In its raw, uncompressed format, the stored data is as follows:
 * {
 *     hashedPageName1: [
 *         [0, 1, 0, 1, 0, 1],
 *         [1, 0, 1, 0, 1, 0],
 *         [0, 0, 0, 0, 0, 0]
 *     ],
 *     hashedPageName2: [
 *         [0, 1, 0, 1, 0, 1],
 *         [1, 0, 1, 0, 1, 0],
 *         [0, 0, 0, 0, 0, 0]
 *     ]
 * }
 *
 * Where `hashedPageNameX` is the value of wgPageName passed through our `hashString` function,
 * the arrays of numbers representing tables on a page (from top to bottom) and the numbers
 * representing whether a row is highlighted or not, depending on if it is 1 or 0 respectively.
 *
 * During compression, these numbers are collected into groups of 6 and converted to base64.
 * For example:
 *
 *   1. [0, 1, 0, 1, 0, 1]
 *   2. 0x010101             (1 + 4 + 16 = 21)
 *   3. BASE_64_URL[21]      (U)
 *
 * Once each table's rows have been compressed into strings, they are concatenated using `.` as a
 * delimiter. The hashed page name (which is guaranteed to be 8 characters long) is then prepended
 * to this string to look something like the following:
 *
 *   XXXXXXXXab.dc.ef
 *
 *
 * The first character of a hashed page name is then used to form the object that is actually
 * stored. As the hashing function uses hexadecimal, this gives us 16 possible characters (0-9A-Z).
 *
 * {
 *     A: ...
 *     B: ...
 *     C: ...
 *     // etc.
 * }
 *
 * The final step of compression is to merge each page's data together under it's respective top
 * level key. this is done by concatenation again, separated by a `!`.
 *
 * The resulting object is then converted to a string and persisted in local storage. When
 * uncompressing data, simply perform the following steps in reverse.
 *
 * For the implementation of this algorithm, see:
 * - `compress`
 * - `parse`
 * - `hashString`
 *
 * Note that while rows could theoretically be compressed further by using all ASCII characters,
 * eventually we'd start using characters outside printable ASCII which makes debugging painful.
 */

/*jshint bitwise:false, camelcase:true, curly:true, eqeqeq:true, es3:false,
    forin:true, immed:true, indent:4, latedef:true, newcap:true,
    noarg:true, noempty:true, nonew:true, plusplus:true, quotmark:single,
    undef:true, unused:true, strict:true, trailing:true,
    browser:true, devel:false, jquery:true,
    onevar:true
*/

(function($, mw, OO) {
    'use strict';

    // constants
    var STORAGE_KEY = 'mw:lightTable', // NOTE: Modify this to be unique for your MediaWiki
        TABLE_CLASS = 'lighttable',
        TBLID = 'tableid',
        ROWID = 'rowid',
        LIGHT_ON_CLASS = 'highlight-on',
        MOUSE_OVER_CLASS = 'highlight-over',
        BASE_64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
        PAGE_SEPARATOR = '!',
        TABLE_SEPARATOR = '.',
        CASTAGNOLI_POLYNOMIAL = 0x04c11db7,
        UINT32_MAX = 0xffffffff,

        self = {
            /*
             * Stores the current uncompressed data for the current page.
             */
            data: null,
            
            /*
             * Init wrapper for jQuery
             */
            jq_init: function() {
                self.init();
            },
            /*
             * Perform initial checks on the page and browser.
             */
            init: function(sorted) {
                mw.log('init beginning');
                var $tables = $('table.' + TABLE_CLASS),
                    hashedPageName = self.hashString(mw.config.get('wgPageName'));

                // check we have some tables to interact with
                if (!$tables.length) {
                    mw.log('no tables found');
                    return;
                }
                mw.log('found tables');

                // INLINED: Check if the browser has support for localStorage
                // AUTHOR: JaydenKieran
                try {
                    localStorage.setItem('test', 'test');
                    localStorage.removeItem('test');
                } catch (e) {
                    mw.log('no local storage found');
                    return;
                }
                mw.log('found localstorage');

                // check if any of the tables are autosort tables
                // and, if so, ensure the autosort gadget runs first
                if (!sorted && $tables.filter('[class*="autosort="]').length) {
                    mw.log('found autosort, waiting a bit');
                    mw.hook('gadget.autosort.sorted').add(function delayInit() {
                        self.init(true);
                        
                        // only run once
                        mw.hook('gadget.autosort.sorted').remove(delayInit);
                        mw.log('removed autosort hook');
                    });
                    
                    return;
                }
                mw.log('loading data');

                self.data = self.load(hashedPageName, $tables.length);
                mw.log('loaded data, initialising tables');
                self.initTables(hashedPageName, $tables);
                mw.log('initialised tables, done');
            },

            /*
             * Initialise table highlighting.
             *
             * @param hashedPageName The current page name as a hash.
             * @param $tables A list of highlightable tables on the current page.
             */
            initTables: function(hashedPageName, $tables) {
                $tables.each(function(tIndex) {
                    var $this = $(this),
                        $table = $this,
                        tblid = $this.data(TBLID),
                        // data cells
                        $cells = $this.find('td'),
                        $rows = $this.find('tr:has(td)'),
                        // don't rely on headers to find number of columns      
                        // count them dynamically
                        columns = 1,
                        tableData = self.data[tIndex],
                        mode = 'cells',
                        initialised = false;
                        
                    if (tblid) {
                        initialised = self.initNamed(tblid);
                    }

                    // Switching between either highlighting rows or cells
                    if (!$this.hasClass('individual')) {
                        mode = 'rows';
                        $cells = $rows;
                    }

                    // initialise rows if necessary
                    while ($cells.length > tableData.length) {
                        tableData.push(0);
                    }

                    // counting the column count
                    // necessary to determine colspan of reset button
                    $rows.each(function() {
                        var $this = $(this);
                        columns = Math.max(columns, $this.children('th,td').length);
                    });

                    $cells.each(function(cIndex) {
                        var $this = $(this),
                            cellData = tableData[cIndex];

                        // forbid highlighting any cells/rows that have class nohighlight
                        if (!$this.hasClass('nohighlight')) {
                            // initialize highlighting based on localStorage, unless namedInit already did that
                            if (!initialised) {
                                self.setHighlight($this, cellData);
                            }

                            // set mouse events
                            $this
                                .mouseover(function() {
                                    self.setHighlight($this, 2);
                                })
                                .mouseout(function() {
                                    self.setHighlight($this, 3);
                                })
                                .click(function(e) {
                                    // don't toggle highlight when clicking links
                                    if ((e.target.tagName !== 'A') && (e.target.tagName !== 'IMG')) {
                                        // 1 -> 0
                                        // 0 -> 1
                                        tableData[cIndex] = 1 - tableData[cIndex];

                                        self.setHighlight($this, tableData[cIndex]);
                                        
                                        if (tblid) {
                                            self.saveNamed($table.data(TBLID));
                                        } else {
                                            self.save(hashedPageName);
                                        }
                                        
                                        e.stopPropagation();
                                    }
                                });
                        }
                    });
                    
                    // if this is a named table, which wasn't initialised yet, make sure to save data to the named system
                    if (tblid && !initialised) {
                        self.saveNamed($table.data(TBLID));
                    }

                    // add a button for reset
                    var button = new OO.ui.ButtonWidget({
                        label: 'Clear selection',
                        icon: 'clear',
                        title: 'Removes all highlights from the table',
                        classes: ['ht-reset'] // this class is targeted by other gadgets, be careful removing it
                    });

                    button.$element.click(function() {
                        $cells.each(function(cIndex) {
                            tableData[cIndex] = 0;
                            self.setHighlight($(this), 0);
                        });

                        if (tblid) {
                            self.saveNamed($table.data(TBLID));
                        } else {
                            self.save(hashedPageName, $tables.length);
                        }
                    });

                    $this.append(
                        $('<tfoot>')
                            .append(
                                $('<tr>')
                                    .append(
                                        $('<th>')
                                            .attr('colspan', columns)
                                            .append(button.$element)
                                    )
                            )
                    );
                });
            },

            /*
             * Change the cell background color based on mouse events.
             *
             * @param $cell The cell element.
             * @param val The value to control what class to add (if any).
             *            0 -> light off (no class)
             *            1 -> light on without hover
             *            2 -> mouse over
             */
            setHighlight: function($cell, val) {
                switch (val) {
                    // no highlighting
                    case 0:
                        $cell.removeClass(MOUSE_OVER_CLASS);
                        $cell.removeClass(LIGHT_ON_CLASS);
                        break;

                    // light on
                    case 1:
                        $cell.removeClass(MOUSE_OVER_CLASS);
                        $cell.addClass(LIGHT_ON_CLASS);
                        break;

                    // mouse-over
                    case 2:
                        $cell.addClass(MOUSE_OVER_CLASS);
                        break;
                        
                    // mouse-out without affecting highlights
                    case 3:
                        $cell.removeClass(MOUSE_OVER_CLASS);
                        break;
                }
            },

            /*
             * Merge the updated data for the current page into the data for other pages into local storage.
             *
             * @param hashedPageName A hash of the current page name.
             */
            save: function(hashedPageName) {
                // load the existing data so we know where to save it
                var curData = localStorage.getItem(STORAGE_KEY),
                    compressedData;

                if (curData === null) {
                    curData = {};
                } else {
                    curData = JSON.parse(curData);
                    curData = self.parse(curData);
                }

                // merge in our updated data and compress it
                curData[hashedPageName] = self.data;
                compressedData = self.compress(curData);

                // convert to a string and save to localStorage
                compressedData = JSON.stringify(compressedData);
                localStorage.setItem(STORAGE_KEY, compressedData);
            },

            /*
             * Compress the entire data set using tha algoritm documented at the top of the page.
             *
             * @param data The data to compress.
             *
             * @return the compressed data.
             */
            compress: function(data) {
                var ret = {};

                Object.keys(data).forEach(function(hashedPageName) {
                    var pageData = data[hashedPageName],
                        pageKey = hashedPageName.charAt(0);

                    if (!ret.hasOwnProperty(pageKey)) {
                        ret[pageKey] = {};
                    }

                    ret[pageKey][hashedPageName] = [];

                    pageData.forEach(function(tableData) {
                        var compressedTableData = '',
                            i, j, k;

                        for (i = 0; i < Math.ceil(tableData.length / 6); i += 1) {
                            k = tableData[6 * i];

                            for (j = 1; j < 6; j += 1) {
                                k = 2 * k + ((6 * i + j < tableData.length) ? tableData[6 * i + j] : 0);
                            }

                            compressedTableData += BASE_64_URL.charAt(k);
                        }

                        ret[pageKey][hashedPageName].push(compressedTableData);
                    });

                    ret[pageKey][hashedPageName] = ret[pageKey][hashedPageName].join(TABLE_SEPARATOR);
                });

                Object.keys(ret).forEach(function(pageKey) {
                    var hashKeys = Object.keys(ret[pageKey]),
                        hashedData = [];

                    hashKeys.forEach(function(key) {
                        var pageData = ret[pageKey][key];
                        hashedData.push(key + pageData);
                    });

                    hashedData = hashedData.join(PAGE_SEPARATOR);
                    ret[pageKey] = hashedData;
                });

                return ret;
            },

            /*
             * Get the existing data for the current page.
             *
             * @param hashedPageName A hash of the current page name.
             * @param numTables The number of tables on the current page. Used to ensure the loaded
             *                  data matches the number of tables on the page thus handling cases
             *                  where tables have been added or removed. This does not check the
             *                  amount of rows in the given tables.
             *
             * @return The data for the current page.
             */
            load: function(hashedPageName, numTables) {
                var data = localStorage.getItem(STORAGE_KEY),
                    pageData;

                if (data === null) {
                    pageData = [];
                } else {
                    data = JSON.parse(data);
                    data = self.parse(data);

                    if (data.hasOwnProperty(hashedPageName)) {
                        pageData = data[hashedPageName];
                    } else {
                        pageData = [];
                    }
                }

                // if more tables were added
                // add extra arrays to store the data in
                // also populates if no existing data was found
                while (numTables > pageData.length) {
                    pageData.push([]);
                }

                // if tables were removed, remove data from the end of the list
                // as there's no way to tell which was removed
                while (numTables < pageData.length) {
                    pageData.pop();
                }

                return pageData;
            },

            /*
             * Parse the compressed data as loaded from local storage using the algorithm desribed
             * at the top of the page.
             *
             * @param data The data to parse.
             *
             * @return the parsed data.
             */
            parse: function(data) {
                var ret = {};

                Object.keys(data).forEach(function(pageKey) {
                    var pageData = data[pageKey].split(PAGE_SEPARATOR);

                    pageData.forEach(function(tableData) {
                        var hashedPageName = tableData.substr(0, 8);

                        tableData = tableData.substr(8).split(TABLE_SEPARATOR);
                        ret[hashedPageName] = [];

                        tableData.forEach(function(rowData, index) {
                            var i, j, k;

                            ret[hashedPageName].push([]);

                            for (i = 0; i < rowData.length; i += 1) {
                                k = BASE_64_URL.indexOf(rowData.charAt(i));

                                // input validation
                                if (k < 0) {
                                    k = 0;
                                }

                                for (j = 5; j >= 0; j -= 1) {
                                    ret[hashedPageName][index][6 * i + j] = (k & 0x1);
                                    k >>= 1;
                                }
                            }
                        });
                    });

                });

                return ret;
            },

            /*
             * Hash a string into a big endian 32 bit hex string. Used to hash page names.
             *
             * @param input The string to hash.
             *
             * @return the result of the hash.
             */
            hashString: function(input) {
                var ret = 0,
                    table = [],
                    i, j, k;

                // guarantee 8-bit chars
                input = window.unescape(window.encodeURI(input));

                // calculate the crc (cyclic redundancy check) for all 8-bit data
                // bit-wise operations discard anything left of bit 31
                for (i = 0; i < 256; i += 1) {
                    k = (i << 24);

                    for (j = 0; j < 8; j += 1) {
                        k = (k << 1) ^ ((k >>> 31) * CASTAGNOLI_POLYNOMIAL);
                    }
                    table[i] = k;
                }

                // the actual calculation
                for (i = 0; i < input.length; i += 1) {
                    ret = (ret << 8) ^ table[(ret >>> 24) ^ input.charCodeAt(i)];
                }

                // make negative numbers unsigned
                if (ret < 0) {
                    ret += UINT32_MAX;
                }

                // 32-bit hex string, padded on the left
                ret = '0000000' + ret.toString(16).toUpperCase();
                ret = ret.substr(ret.length - 8);

                return ret;
            },
            
            /*
             * Save highlighted rows for named tables, using the data-tableid attribute.
             * Does not override values that are not present in the current table. This allows usethe use of a single
             * table ID on pages like [[Music]]
             *
             * @param tblid The table id for the table to initialise
             */
            saveNamed: function(tblid) {
                // local storage key is prefixed by the generic storage key, to avoid local storage naming conflicts.
                var lsKey = STORAGE_KEY + ':' + tblid,
                    data = localStorage.getItem(lsKey);
                var $tbls = $('table.lighttable[data-tableid="'+tblid+'"]')

                if (data === null) {
                    data = {};
                } else {
                    data = JSON.parse(data);
                }
                
                $tbls.find('[data-rowid]').each(function() {
                    var id = $(this).data('rowid');
                    if (!id) return;
                    data[id] = Number($(this).hasClass(LIGHT_ON_CLASS));
                });

                localStorage.setItem(lsKey, JSON.stringify(data));
            },
            
            /*
             * Initialise a named table that uses data-tableid
             *
             * @param tblid The table id for the table to initialise
             * @return Boolean true if successfully initialised, false if no named highlight data was available
             */
            initNamed: function(tblid) {
                var lsKey = STORAGE_KEY + ':' + tblid;
                var data = localStorage.getItem(lsKey);
                var $tbls = $('table.lighttable[data-tableid="'+tblid+'"]')
                if (data === null) {
                    // no data stored yet, so fall back to unnamed init
                    return false;
                }
                var data = JSON.parse(data);

                $tbls.find('[data-rowid]').each(function() {
                    var id = $(this).data('rowid')
                    if (!id) return;
                    if ($('[data-rowid="'+id+'"]').length > 1) {
                        mw.log.warn('Reused rowid detected in named lighttable:', id, $('[data-rowid="'+id+'"]'));
                    }
                    self.setHighlight($(this), Number(data[id]))
                });
                return true;
            }
        };

    $(self.jq_init);

    /*
    // sample data for testing the algorithm used
    var data = {
        // page1
        '0FF47C63': [
            [0, 1, 1, 0, 1, 0],
            [0, 1, 1, 0, 1, 0, 1, 1, 1],
            [0, 0, 0, 0, 1, 1, 0, 0]
        ],
        // page2
        '02B75ABA': [
            [0, 1, 0, 1, 1, 0],
            [1, 1, 1, 0, 1, 0, 1, 1, 0],
            [0, 0, 1, 1, 0, 0, 0, 0]
        ],
        // page3
        '0676470D': [
            [1, 0, 0, 1, 0, 1],
            [1, 0, 0, 1, 0, 1, 0, 0, 0],
            [1, 1, 1, 1, 0, 0, 1, 1]
        ]
    };

    console.log('input', data);

    var compressedData = self.compress(data);
    console.log('compressed', compressedData);

    var parsedData = self.parse(compressedData);
    console.log(parsedData);
    */

}(this.jQuery, this.mediaWiki, this.OO));

// </pre>
