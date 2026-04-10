PerfectNineties — put your font file here
=========================================

Add your file to this folder (next to this README) as:

  PerfectNineties.woff2

If you only have a TrueType file, name it:

  PerfectNineties.ttf

Then open src/app/globals.css and in the @font-face rule for "PerfectNineties",
change the url() to match (e.g. /fonts/PerfectNineties.ttf) and use format("truetype").

After adding the file, restart the dev server if it was already running.
