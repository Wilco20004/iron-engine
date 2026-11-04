import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// The workout: one row per exercise (a superset is one row), then cardio,
// another workout, sync and finish.
class SessionMenu extends WatchUi.Menu2 {
    var rows;   // lift indices per row

    function initialize() {
        var s = getApp().session;
        Menu2.initialize({:title => s["title"]});
        rows = liftRows(s["lifts"]);
        for (var i = 0; i < rows.size(); i++) {
            addItem(new WatchUi.IconMenuItem(rowLabel(rows[i]), rowSubLabel(rows[i]), i, rowIcon(rows[i]), null));
        }
        var c = s["cardio"];
        addItem(new WatchUi.IconMenuItem("Cardio", cardioSubLabel(), :cardio, new StatusIcon(c["done"] ? 1 : 0, 1), null));
        addItem(new WatchUi.MenuItem("Other workout", s["weekName"] + (s["weekDone"] == true ? ": all done" : ""), :other, null));
        addItem(new WatchUi.MenuItem("Sync", syncSubLabel(), :sync, null));
        addItem(new WatchUi.MenuItem("Finish workout", finishSubLabel(), :finish, null));
    }

    function refresh() {
        for (var i = 0; i < rows.size(); i++) {
            var item = getItem(i);
            if (item != null) {
                item.setSubLabel(rowSubLabel(rows[i]));
                (item as WatchUi.IconMenuItem).setIcon(rowIcon(rows[i]));
            }
        }
        var n = rows.size();
        var cardio = getItem(n);
        if (cardio != null) {
            cardio.setSubLabel(cardioSubLabel());
            (cardio as WatchUi.IconMenuItem).setIcon(new StatusIcon(getApp().session["cardio"]["done"] ? 1 : 0, 1));
        }
        var sync = getItem(n + 2);
        if (sync != null) {
            sync.setSubLabel(syncSubLabel());
        }
        var finish = getItem(n + 3);
        if (finish != null) {
            finish.setSubLabel(finishSubLabel());
        }
        WatchUi.requestUpdate();
    }
}

// Groups lifts into menu rows: lifts with the same superset letter share a row.
function liftRows(lifts) {
    var rows = [];
    var byGroup = {};
    for (var i = 0; i < lifts.size(); i++) {
        var g = lifts[i]["group"];
        if (g != null && g.length() > 0) {
            var r = byGroup[g];
            if (r != null) {
                rows[r].add(i);
                continue;
            }
            byGroup[g] = rows.size();
        }
        rows.add([i]);
    }
    return rows;
}

function rowLabel(row) {
    var lifts = getApp().session["lifts"];
    if (row.size() == 1) {
        return shortName(lifts[row[0]]["name"]);
    }
    var names = "";
    for (var i = 0; i < row.size(); i++) {
        names += (i > 0 ? " + " : "") + shortName(lifts[row[i]]["name"]);
    }
    return names;
}

function rowSubLabel(row) {
    var lifts = getApp().session["lifts"];
    if (row.size() == 1) {
        return liftSubLabel(lifts[row[0]]);
    }
    var done = 0;
    var sets = 0;
    for (var i = 0; i < row.size(); i++) {
        done += lifts[row[i]]["logged"].size();
        sets += lifts[row[i]]["sets"];
    }
    return "Superset " + lifts[row[0]]["group"] + "  " + (done >= sets ? "Done" : done + "/" + sets + " sets");
}

function rowIcon(row) {
    var lifts = getApp().session["lifts"];
    var done = 0;
    var sets = 0;
    for (var i = 0; i < row.size(); i++) {
        done += lifts[row[i]]["logged"].size();
        sets += lifts[row[i]]["sets"];
    }
    return new StatusIcon(done, sets);
}

// Menu row icon: empty ring (not started), partial ring (in progress), green tick (done).
class StatusIcon extends WatchUi.Drawable {
    hidden var done;
    hidden var total;

    function initialize(d, t) {
        Drawable.initialize({});
        done = d;
        total = t;
    }

    function draw(dc) {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var r = (cx < cy ? cx : cy) * 0.6;
        var pen = r * 0.28;
        dc.setPenWidth(pen < 2 ? 2 : pen);
        if (done >= total) {
            dc.setColor(Theme.GOOD, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(cx, cy, r);
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            dc.drawLine(cx - r * 0.45, cy, cx - r * 0.1, cy + r * 0.38);
            dc.drawLine(cx - r * 0.1, cy + r * 0.38, cx + r * 0.5, cy - r * 0.35);
        } else {
            dc.setColor(Theme.MUTED, Graphics.COLOR_TRANSPARENT);
            dc.drawCircle(cx, cy, r);
            if (done > 0) {
                dc.setColor(Theme.ACCENT, Graphics.COLOR_TRANSPARENT);
                dc.drawArc(cx, cy, r, Graphics.ARC_CLOCKWISE, 90, 90 - 360 * done / total);
            }
        }
        dc.setPenWidth(1);
    }
}

function liftSubLabel(lift) {
    var done = lift["logged"].size();
    var sets = lift["sets"];
    if (done >= sets) {
        return "Done " + done + "/" + sets;
    }
    var kg = lift["kg"];
    return done.toString() + "/" + sets + " sets  " + lift["reps"] + (kg != null && kg.length() > 0 ? " @ " + kg : "");
}

function cardioSubLabel() {
    var c = getApp().session["cardio"];
    return (c["done"] ? "Done: " : "") + c["kind"];
}

function finishSubLabel() {
    return getApp().workout.active() ? "Recording to Garmin" : "Starts with your first exercise";
}

function syncSubLabel() {
    var app = getApp();
    if (app.status.length() > 0) {
        return app.status;
    }
    return app.queue.size() > 0 ? app.queue.size().toString() + " waiting" : "Up to date";
}

class SessionMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId();
        var app = getApp();
        if (id == :cardio) {
            app.workout.enter(:cardio);
            var cv = new CardioView();
            WatchUi.pushView(cv, new CardioDelegate(cv), WatchUi.SLIDE_LEFT);
        } else if (id == :other) {
            WatchUi.pushView(new OtherDayMenu(), new OtherDayDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :sync) {
            app.postNext();
            app.loadSession(app.session["week"], app.session["day"]);
        } else if (id == :finish) {
            if (app.workout.active()) {
                WatchUi.pushView(new FinishMenu(), new FinishDelegate(), WatchUi.SLIDE_UP);
            }
        } else {
            var row = app.menu.rows[id];
            app.workout.enter(row[0]);
            var ev = new ExerciseView(row);
            WatchUi.pushView(ev, new ExerciseDelegate(ev), WatchUi.SLIDE_LEFT);
        }
    }

    // Back from the session menu would close the app; while recording, ask first.
    function onBack() {
        if (getApp().workout.active()) {
            WatchUi.pushView(new FinishMenu(), new FinishDelegate(), WatchUi.SLIDE_UP);
            return;
        }
        Menu2InputDelegate.onBack();
    }
}

// Save the Garmin activity, throw it away, or carry on training.
class FinishMenu extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({:title => "Finish workout"});
        addItem(new WatchUi.MenuItem("Save", "To Garmin Connect", :save, null));
        addItem(new WatchUi.MenuItem("Keep going", null, :resume, null));
        addItem(new WatchUi.MenuItem("Discard", "Delete this activity", :discard, null));
    }
}

class FinishDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId();
        if (id == :save) {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            getApp().finishWorkout(true);
            getApp().refreshMenu();
        } else if (id == :discard) {
            WatchUi.pushView(new WatchUi.Confirmation("Delete this activity?"), new DiscardDelegate(), WatchUi.SLIDE_UP);
        } else {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        }
    }
}

class DiscardDelegate extends WatchUi.ConfirmationDelegate {
    function initialize() {
        ConfirmationDelegate.initialize();
    }

    function onResponse(response) {
        if (response == WatchUi.CONFIRM_YES) {
            getApp().finishWorkout(false);
            // The confirmation closes itself; also close the finish menu underneath.
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            getApp().refreshMenu();
        }
        return true;
    }
}

// Pick another workout this week (any order), or the next one still to do.
class OtherDayMenu extends WatchUi.Menu2 {
    function initialize() {
        var s = getApp().session;
        Menu2.initialize({:title => s["weekName"]});
        addItem(new WatchUi.MenuItem("Next to do", null, :next, null));
        var days = s["week_sessions"];
        for (var i = 0; i < days.size(); i++) {
            addItem(new WatchUi.MenuItem(days[i]["title"], days[i]["done"] ? "Done" : "", days[i]["day"], null));
        }
    }
}

class OtherDayDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId();
        var app = getApp();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        if (id == :next) {
            app.loadSession(null, null);
        } else {
            app.loadSession(app.session["week"], id);
        }
    }
}
