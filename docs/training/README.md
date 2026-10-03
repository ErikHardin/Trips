# Hardin Trips — Training Guide

A walkthrough of the Trips app for the whole family: how to sign in, find your way around a trip, add memories, and (for admins) plan and manage trips.

> 📄 **Printable version:** [Hardin-Trips-Training-Guide.pdf](Hardin-Trips-Training-Guide.pdf)
>
> The screenshots use made-up sample trips. Your own trips and names will be different. To regenerate the screenshots after the app changes, see [`tools/README.md`](tools/README.md).

## Contents

1. [Signing in](#1-signing-in)
2. [Who can do what](#2-who-can-do-what)
3. [The home screen](#3-the-home-screen)
4. [A trip's itinerary](#4-a-trips-itinerary)
5. [Memories: notes and photos](#5-memories-notes-and-photos)
6. [Quick-editing a day's activities](#6-quick-editing-a-days-activities)
7. [The Overview tab](#7-the-overview-tab)
8. [The Logistics tab](#8-the-logistics-tab)
9. [The Changes tab](#9-the-changes-tab)
10. [The Wishlist tab](#10-the-wishlist-tab)
11. [Sharing a trip](#11-sharing-a-trip)
12. [Editing a trip](#12-editing-a-trip)
13. [The world map](#13-the-world-map)
14. [The admin screen](#14-the-admin-screen)
15. [Tips and FAQ](#15-tips-and-faq)

---

## 1. Signing in

<img src="img/01-login.png" width="280" align="right" alt="Login screen">

Open the app and pick one way to sign in. Each one works with the email address Erik gave access to:

- **Sign in with Google**: use your Google account.
- **Sign in with Apple**: use your Apple ID. If Apple asks, choosing **Share My Email** is simplest. If you choose **Hide My Email**, Apple makes up a private address, and Erik has to add that address instead (the app shows it to you).
- **Email and password**, for any other email (Yahoo, Outlook, iCloud, work):
  1. Tap **Create account**, enter your name, email and a password of at least 8 characters (type it twice to confirm), then tap **Create account** again.
  2. Open the verification email and tap its link.
  3. Back in the app, tap **I've verified**.

  Next time, just tap **Sign in**. If you forget the password, enter your email and tap **Forgot password?**.

If your email hasn't been added yet, the app sends Erik a request for you and shows *"Thanks! Your request to join was sent…"*. Leave the page open, or come back later: it opens by itself once an admin approves you. To try another account, tap **Sign in with a different account**.

- **Install it like an app:** in Safari, tap **Share → Add to Home Screen**. The app then opens full-screen with its own icon.
- **To sign out**, tap the 🔒 lock in the top-right corner of the home screen, then **Sign out**.
- **To delete your account**, tap the 🔒 lock, then **Delete account**. You confirm with your sign-in one more time. This removes your sign-in and your access. Trips you created stay in the app for everyone else.

<br clear="all">

## 2. Who can do what

Every account has one of three roles. Admins set roles under **Admin → User Access** ([section 14](#user-access)).

| | Guest | User | Admin |
|---|:-:|:-:|:-:|
| See trips | Only trips they've been given | Their own trips, plus any shared with them | All trips |
| Add memories, wishlist ideas, quick activity edits | ✅ on their trips | ✅ | ✅ |
| Create new trips | — | ✅ (their own) | ✅ |
| Edit trip details, Logistics tab | — | ✅ on their own trips | ✅ |
| Admin tools (AI assistant, users, PDFs, CSV import…) | — | — | ✅ |

---

## 3. The home screen

<img src="img/02-home.png" width="280" align="right" alt="Home screen">

The home screen lists your trips as cards:

- **In progress** trips come first. They show a 🟢 badge and a bar counting nights completed (for example, *6/8 nt*).
- **Upcoming** trips come next, soonest first, with a countdown (*180 days away*).
- **Past trips** are grouped in a collapsed section at the bottom. Tap it to expand.

Tap a card to open the trip. **When a trip is in progress, the app opens straight to it.** Tap **‹** to get back to the list.

Header buttons:

- 🌏 **World Map**: every place you've been ([section 13](#13-the-world-map)).
- ⚙️ **Admin**: admins only ([section 14](#14-the-admin-screen)).
- 🔒 **Sign out**.

**＋ Add New Trip** takes admins and users to the trip-creation form.

<br clear="all">

<img src="img/03-home-past-trips.png" width="280" alt="Past trips expanded">

---

## 4. A trip's itinerary

<img src="img/04-itinerary-top.png" width="280" align="right" alt="Itinerary tab">

Opening a trip shows the **Itinerary** tab. Along the top are the other tabs: **Overview**, **Logistics**, **Changes** and **Wishlist**. Which tabs you see depends on your role and the trip's status.

From top to bottom:

- **🔗 Share** creates a link anyone can open without signing in ([section 11](#11-sharing-a-trip)).
- **In Progress** bar: shows how far into the trip you are (*Night 6 of 8*).
- **Flight banners** for outbound and return flights. A red **+1** means the flight lands the next day.
- **Region headers** (*Lisbon*, *Alentejo*…) group days by area, with the region's dates and a **pill showing the current local time there**.
- **Day cards**: date, what the day is about, the hotel, the city, and a **weather pill** (forecast high/low for upcoming days, actual weather for past days). A 🗣️ chip appears on days in a foreign-language country; tap it for useful local phrases.

In the header, 🔄 refreshes the current tab and ✏️ opens the full trip editor (admins and trip owners).

<br clear="all">

### Inside a day

<img src="img/05-day-expanded.png" width="280" align="right" alt="An expanded day card">

Tap a day card to expand it. **Today's** card is outlined and marked *TODAY*, and the app scrolls to it automatically.

- **📝 Day Memories** holds notes and photos about the day as a whole.
- Each **activity** shows its time and booking status:

  | Icon | Meaning |
  |:-:|---|
  | 📆 | Booked |
  | 💲 | Paid |
  | 🗓️ | Not booked yet |
  | 🚫 | No reservations taken |
  | 🚶🏼 | Walking in |
  | ★ Michelin | Michelin-starred restaurant |
  | 🚗 driving | You'll drive to this one |

- Tap an **activity's name** to search for it on Google.
- **📍** opens the place in Google Maps or Waze (see below).
- **📝** opens that activity's memories. The small number underneath counts how many there are.
- **🔔** (in-progress trips, activities with a time): sets a phone reminder telling you when to leave. It uses the drive time when one is known, otherwise 30 minutes early. Reminders can only be set up to 3 days ahead.
- **💰 Daily spend** (trip owner only): tap **+ add** to log what you spent that day. The trip total appears in Logistics.
- The green bar at the bottom shows that night's **hotel**.
- **✏️** on the day card opens the quick activity editor ([section 6](#6-quick-editing-a-days-activities)).

<br clear="all">

### Opening a place in Maps

<img src="img/06-maps-choice.png" width="280" align="right" alt="Open in Maps sheet">

Tapping 📍 asks whether to open **Google Maps** or **Waze**.

If the app pins the wrong spot, you can fix it: in Google Maps, long-press the correct location, copy the coordinates from the address card, paste them into the box here, and tap **Pin**. The app remembers the corrected location for maps and drive times.

<br clear="all">

---

## 5. Memories: notes and photos

<img src="img/07-notes.png" width="280" align="right" alt="Memories screen">

Tap **📝** next to an activity, or **Day Memories** on a day card, to open its memories.

- Type in **Add a Memory**: what you thought, tips for next time, what to order.
- Tap **📷 Add Photos & Videos** to attach pictures or clips from your phone.
- Tap **Save Memory**. Everyone with access to the trip will see it.
- Use **✏️ Edit** or **🗑️ Delete** on your saved memories.
- Tap any photo to view it full-screen. Swipe or use the arrows to move between photos.
- **Recommend this activity** (admins): marks the activity with ⭐ *Recommended* in the trip's Memories and in shared links.

Adding photos needs an internet connection. See [Tips and FAQ](#15-tips-and-faq) for offline use.

<br clear="all">

---

## 6. Quick-editing a day's activities

<img src="img/08-quick-edit.png" width="280" align="right" alt="Quick activity editor">

The ✏️ on a day card opens a quick editor for that day's activities:

- **▲ / ▼** reorder activities.
- Change the **time** (use am/pm, like `7:30pm` or `10am–2pm`).
- 🚗 toggles whether you're driving there. That controls the drive-time estimate.
- The **status** menu sets the booking status (Booked, Paid, Not booked…).
- **✕** removes an activity. **＋ Add Activity** adds one.
- Tap **Save Activities** when done, or **Cancel** to throw away your changes.

Every change is recorded in the **Changes** tab.

<br clear="all">

---

## 7. The Overview tab

<img src="img/09-overview.png" width="280" align="right" alt="Overview tab">

**Overview** is the trip at a glance:

- All **flights**: outbound, any flights during the trip, and return.
- **Stats**: number of nights and the year.
- **Where you stayed**: each hotel, color-coded by region.

<br clear="all">

<img src="img/10-overview-map.png" width="280" align="right" alt="Overview map and memories">

Further down:

- **Map** of the route, with a colored dot for each stop. Pinch or use **+/−** to zoom, and tap a dot to see the city's name.
- **Memories**: every note saved on the trip, grouped by day, with recommended activities highlighted.

<br clear="all">

---

## 8. The Logistics tab

<img src="img/11-logistics.png" width="280" align="right" alt="Logistics tab">

**Logistics** is for getting ready. It appears on upcoming and in-progress trips for people who can manage the trip.

- **Trip Spend**: total of the daily spend entries, with a rough US-dollar conversion.
- **Booking Checklist**: tick off Flights, Hotels and Car Rental. Tap **＋** on a row to add individual items (for example, one line per hotel). The bar shows how much is booked.
- **Packing List**: one list per person (next screenshot).

<br clear="all">

<img src="img/12-logistics-packing.png" width="280" align="right" alt="Packing list">

Tap a person to open their packing list:

- Tick items as you pack. The badge shows *% packed*.
- **Add item…** at the bottom of each section adds something new. ✏️ renames an item and ✕ removes it.
- Tap the round avatar to change that person's picture.
- **Clear list & regenerate** replaces the lists with a fresh copy of the family template. Admins edit that template under **Admin → Logistics Packing List**.

New trips created by an admin start with the family's packing template automatically.

<br clear="all">

---

## 9. The Changes tab

<img src="img/13-changes.png" width="280" align="right" alt="Changes tab">

**Changes** lists the 25 most recent edits to the trip: what changed, who changed it, and when. Use it to answer "who moved dinner to 8?"

<br clear="all">

---

## 10. The Wishlist tab

<img src="img/14-wishlist.png" width="280" align="right" alt="Wishlist tab">

**Wishlist** is a shared scratchpad of places and ideas that aren't on the itinerary yet.

- Enter an emoji, a name, and optional notes or a link, then tap **＋ Add to Wishlist**.
- **→ Add to Day** (people who can manage the trip) moves the idea onto a specific day of the itinerary.
- **Edit** and **Remove** do what they say.

<br clear="all">

---

## 11. Sharing a trip

Tap **🔗 Share** at the top of the Itinerary tab. On a phone, the share sheet opens so you can text or email the link. Otherwise the link is copied to your clipboard.

Anyone with the link can view the trip **without signing in**, read-only. The shared view has two tabs:

| Itinerary | Highlights |
|:-:|:-:|
| <img src="img/27-share-itinerary.png" width="260" alt="Shared itinerary"> | <img src="img/28-share-highlights.png" width="260" alt="Shared highlights"> |

- **Itinerary**: flights, hotels, a route map and a day-by-day summary.
- **Highlights**: days with memories, and the activities you recommended.

---

## 12. Editing a trip

<img src="img/15-edit-trip.png" width="280" align="right" alt="Edit trip — details">

Tap **✏️** in a trip's header (or **Edit** under **Admin → Manage Existing Trips**) to open the full editor.

**Trip Details**: name, year, date text, cover emoji (use two flags for a multi-country trip, like 🇮🇹🇫🇷), status (*Upcoming*, *Active (in progress)* or *Past*), currency symbol for daily spend, and whether the trip appears on the world map.

**Flights**: tap **＋ Add Flight**, enter flight numbers and dates, then tap **Look Up All**. The app fills in routes and times automatically. Flights are sorted into Outbound, Return and In-trip. You can add a traveler's name to a flight when family members fly separately.

Tap **Save** (top-right) or **Save Trip Details** to keep your changes.

<br clear="all">

<img src="img/16-edit-trip-days.png" width="280" align="right" alt="Edit trip — days">

**Days & Activities**: every day of the trip. Days already travelled are collapsed under *Past Days*.

- **Edit** on a day changes its city, hotel, region, region color and activities.
- **＋ Add Day** adds a day to the end of the trip.
- **⇄ Shift Days** moves the whole trip earlier or later, for example when flights change.

<br clear="all">

---

## 13. The world map

<img src="img/17-world-map.png" width="280" align="right" alt="World map">

Tap 🌏 on the home screen to see every city from every trip on one map. The totals appear along the bottom. Tap a dot to see what trip it was.

Admins can hide a trip from the map with the **Show on world map** checkbox in the trip editor.

<br clear="all">

---

## 14. The admin screen

<img src="img/18-admin.png" width="280" align="right" alt="Admin screen">

Tap ⚙️ on the home screen. Each section opens and closes with **＋ / −**. The PR number of the currently deployed version is shown at the very bottom.

**Trips**
- Add New Trip
- Manage Existing Trips
- AI Trip Assistant
- Travel for Trips

**Utilities**
- User Access
- App Name
- Translations
- Import from CSV
- Logistics Packing List
- Create Trip PDF

Users (not just admins) see **Add New Trip** here too.

<br clear="all">

### Add a new trip

<img src="img/19-admin-add-trip.png" width="280" align="right" alt="Add New Trip">

1. Enter a **trip name** and a **cover emoji** (flags work well).
2. Choose the **status**: *Upcoming*, *Active* or *Past*.
3. Pick the **start and end dates**. The app previews how many days it will create.
4. Tap **Create Trip & Generate Days**.

You get one blank day per date. Fill them in with the trip editor, the AI assistant (next), or a CSV import.

<br clear="all">

### Manage existing trips

<img src="img/20-admin-manage-trips.png" width="280" align="right" alt="Manage Existing Trips">

Trips are grouped into Active, Upcoming and Past. Tap **Edit** to open the trip editor, or 🗑️ to delete a trip. You'll be asked to confirm, and deleting can't be undone.

<br clear="all">

### AI Trip Assistant

<img src="img/21-admin-ai.png" width="280" align="right" alt="AI Trip Assistant">

Pick a trip, then describe a change in plain English:

- *"Add dinner at Le Bernardin at 7:30pm on day 3"*
- *"Update outbound flight to UA100 DEN-LIS 8am-10pm"*
- *"Move the wine tasting on May 26 to 3pm"*

Tap **✨ Ask Assistant**. The proposed changes appear in a preview. Nothing is saved until you tap **Apply Changes**.

**If the trip has no itinerary yet**, the assistant offers two other modes:

- **✍️ Describe & Generate**: enter your travel style, pace, things to avoid and must-dos, then tap **🗺️ Generate Itinerary**.
- **📋 Paste My Notes**: paste notes you've already written (dates, hotels, plans) and tap **📋 Parse My Notes** to turn them into days.

<br clear="all">

### Travel for Trips

<img src="img/23-admin-travel.png" width="280" align="right" alt="Travel for Trips">

A year-by-year planning tracker, separate from the trips themselves. Tap the **Flights**, **Hotel** and **Car** cells on each row to cycle through *–* (to do), *✓* (booked) and *N/A*. Rows with anything still to do are marked in orange.

- **＋ Add Year** starts a new year. Enter a trip name and dates, then tap **＋ Add**.
- **Trip Ideas** is a list, for each year, of trips you're thinking about but haven't planned yet.
- Once a day, admins get a pop-up at sign-in listing trips with bookings still outstanding.

<br clear="all">

### User Access

<img src="img/22-admin-users.png" width="280" align="right" alt="User Access">

Everyone who can sign in is listed here, grouped into Admins, Users and Guests, with their last sign-in time.

**Waiting for access** appears at the top when someone has signed in but isn't on the list yet. It shows their name, email and how they signed in (Google, Apple or email and password). Admins also get a toast when they open the app, and a push on the ntfy reminders topic when a new request arrives.

- **Approve** fills in the Add User form with their name and email. Choose a role and trips, then tap **Add User**. The request disappears, and their screen opens the app on its own.
- **Dismiss** removes the request without giving access. If they sign in again, a new request appears.

**To add someone:**

1. Enter their **name** and the **email address they'll sign in with**. Any email works: Google, Apple or email and password. For someone who used Apple's **Hide My Email**, enter the `…@privaterelay.appleid.com` address the app showed them.
2. Choose a **role** (see [section 2](#2-who-can-do-what)).
3. For guests and users, tick the **trips** they should see.
4. Tap **Add User**.

Use **Edit** to change someone's role or trips, and **Remove** to revoke access.

<br clear="all">

### Other utilities

<img src="img/24-admin-packing.png" width="280" align="right" alt="Logistics Packing List template">

- **App Name**: the family name shown in the header ("*Hardin* Trips").
- **Translations**: choose which cities or regions get the 🗣️ phrase chip. Add a keyword that matches the day's city or region, plus the country code.
- **Import from CSV**: bulk-load days into a trip. Pick the trip, then choose a file or paste the data. Columns: `Date, Day, City, Hotel, Activities, Region, RegionColor`. Separate activities with `|`.
- **Logistics Packing List**: the family packing template (one list per person) that new trips start with.
- **Create Trip PDF**: a printable itinerary for any trip (next screenshot).

<br clear="all">

<img src="img/25-admin-pdf.png" width="280" alt="Create Trip PDF">

---

## 15. Tips and FAQ

<img src="img/26-guest-home.png" width="280" align="right" alt="What a guest sees">

**What does a guest see?** Only the trips they've been given, with no ⚙️ Admin button. The header uses their own name ("*Grandma's* Trips"). Guests can read everything on their trips and add memories and wishlist ideas.

**Does it work offline?** Mostly. The app keeps a copy of your trips on the phone. With no signal, a banner reads *📴 Offline — viewing saved data*. You can still read everything, and edits you make are sent when you're back online. Photo uploads and maps need a connection.

**I don't see my change.** Tap 🔄 in the trip header to refresh the current tab.

**Why can't I see the Logistics tab?** It only appears on upcoming and in-progress trips, and only for people who can manage the trip.

**Can I undo a change?** There's no undo button, but the **Changes** tab shows what the value was, so you can put it back by hand.

**A place is pinned in the wrong spot on the map.** Fix it with the Pin option in the Maps sheet ([section 4](#opening-a-place-in-maps)).

<br clear="all">
