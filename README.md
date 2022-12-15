# MediaWiki table highlighting
The source code has been taken from the [runescape.wiki](https://runescape.wiki/) The individual contributors can be found inside the source code files. This project combines the original (version 4.0) of the ``Gadget-highlightTable-core.js`` with the ``hasLocalStorage`` function inlined to allow deployment on other of the shelf MediaWiki websites.

## Contributors
The contributors prior to being posted on GitHub:
- Quarenon
- Saftzie
- Cqm
- mejrs
- Mr Dew
- Joeytje50
- JaydenKieran

# Prerequisites
- Having installed the [Gadgets Extension](https://www.mediawiki.org/wiki/Extension:Gadgets)
  - Download the extension [here](https://www.mediawiki.org/wiki/Special:ExtensionDistributor/Gadgets)
  - Extract the file with ``tar -xzf Gadgets-REL1_39-736f063.tar.gz -C /var/www/mediawiki/extensions``
  - Load the Gadgets extension by adding ``wfLoadExtension( 'Gadgets' );`` to the end of your ``LocalSettings.php`` file.
  - Navigate to ``Special:Version`` to verify the extension is installed.

# Deploying

1. Copy the contents of the ``src/Gadget-highlightTable.css`` to ``MediaWiki:Gadget-highlightTable.css``
2. Copy the contents of the ``src/Gadget-highlightTable-core.js`` to ``MediaWiki:Gadget-highlightTable-core.js``
3. Copy the following content to ``MediaWiki:Gadgets-definition``:
```
* highlightTable[ResourceLoader|type=general|targets=desktop,mobile|default]|highlightTable.js|highlightTable.css
* highlightTable-core[ResourceLoader|type=general|dependencies=oojs-ui-core,oojs-ui.styles.icons-interactions|targets=desktop,mobile|hidden]|highlightTable-core.js
```
4. Copy the contents of the ``src/Gadget-highlightTable.js`` to ``MediaWiki:Gadget-highlightTable.js``
5. Check if the ``HighlightTable`` gadget is enabled in ``Special:Preferences#mw-prefsection-gadgets``
   1. If the ``Gadgets`` tab or the ``LightTable`` gadget is not visible it means it is not installed correctly.

# Usage
Add the ``lighttable`` class to any table you wish to have highlighting enabled for. E.g.
```
{| role="presentation" class="wikitable sortable lighttable"
! Alphabet
|-
| C
|-
| A
|-
| B
|}
```
