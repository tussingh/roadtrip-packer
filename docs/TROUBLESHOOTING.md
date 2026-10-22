# Troubleshooting

**The app does not open offline.**
Open it once while online *from the installed icon* and wait for “Installed for offline use”. On iPhone, the Home Screen app and Safari have separate storage: install first, then use the installed app. Maps → Regions shows “App offline: Yes” once the service worker controls the page.

**“Local storage is unavailable”.**
Private/incognito windows and some privacy settings block IndexedDB. Use a normal window or the installed app.

**My data disappeared.**
The browser cleared site storage (low space, “clear browsing data”, or iOS evicting a non-installed web app). Restore from your latest backup. Then install to the Home Screen and request persistent storage in Settings.

**An update is waiting.**
A toast says “A new version is ready”. Tap *Reload*. Updates never apply mid-edit.

**Quantities look wrong.**
Tap the item to see the calculation. Check the trip’s days, driving days, distance and laundry, the child’s birth date, and the assumptions (Trip → Assumptions, or Settings for family-wide defaults). Your own quantity override always wins and survives list updates.

**An item I unticked or edited vanished after editing the trip.**
Items the rules no longer produce are removed only if you had not touched them. Touched ones stay with a “No longer suggested” tag. Use undo (↶) in the checklist for recent changes.

**Reminders do not pop up.**
Web apps cannot reliably notify while closed, especially on iOS. Use *Trip → Packing schedule → Add to calendar* and import the `.ics` file into your calendar app.

**Region download stops.**
Phones pause web pages in the background. Keep the app open on Wi-Fi; if it stops, tap *Resume download* — completed parts are kept. If the host changed the file, the download restarts automatically.

**“Checksum mismatch”.**
The file did not match the catalog (corrupted transfer or a changed file with an old catalog). The data was removed; download again or regenerate the catalog.

**“Catalog request failed” / CORS errors.**
The host must allow your app’s origin, `Range` and `If-Range` headers, and expose `ETag`/`Content-Range`. See [MAP-DATA.md](MAP-DATA.md). Or copy the files to the phone and use *Region file from device*.

**No route found.**
- *Outside the downloaded road data*: all points must be inside one region with a road network.
- *No major road within 5 km*: the graph contains main roads only; pick a nearby town instead.
- *No connected road path*: a connecting road is missing from the extract or lies outside the region.

**Map labels are missing for some places.**
Bundled fonts cover Latin script. Places without an English or Latin-script name may show no label (search still works with local-script names stored in the index).

**Map shows grey with no detail when zoomed in.**
You are beyond the region’s max zoom or outside its bounding box. Build the region with a higher `--maxzoom` or larger bbox.
