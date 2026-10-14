import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Today's session: one row per exercise, then cardio, another day, and sync.
class SessionMenu extends WatchUi.Menu2 {
    function initialize() {
        var s = getApp().session;
        Menu2.initialize({:title => s["title"]});
        var lifts = s["lifts"];
        for (var i = 0; i < lifts.size(); i++) {
            addItem(new WatchUi.IconMenuItem(shortName(lifts[i]["name"]), liftSubLabel(lifts[i]), i, liftIcon(lifts[i]), null));
        }
        var c = s["cardio"];
        addItem(new WatchUi.IconMenuItem("Cardio", cardioSubLabel(), :cardio, new StatusIcon(c["done"] ? 1 : 0, 1), null));
        addItem(new WatchUi.MenuItem("Other day", s["weekName"], :other, null));
        addItem(new WatchUi.MenuItem("Sync", syncSubLabel(), :sync, null));
        addItem(new WatchUi.MenuItem("Finish workout", finishSubLabel(), :finish, null));
    }

    function refresh() {
        var lifts = getApp().session["lifts"];
        for (var i = 0; i < lifts.size(); i++) {
            var item = getItem(i);
            if (item != null) {
                item.setSubLabel(liftSubLabel(lifts[i]));
                (item as WatchUi.IconMenuItem).setIcon(liftIcon(lifts[i]));
            }
        }
        var cardio = getItem(lifts.size());
        if (cardio != null) {
            cardio.setSubLabel(cardioSubLabel());
            (cardio as WatchUi.IconMenuItem).setIcon(new StatusIcon(getApp().session["cardio"]["done"] ? 1 : 0, 1));
        }
        var sync = getItem(lifts.size() + 2);
        if (sync != null) {
            sync.setSubLabel(syncSubLabel());
        }
        var finish = getItem(lifts.size() + 3);
        if (finish != null) {
            finish.setSubLabel(finishSubLabel());
        }
        WatchUi.requestUpdate();
    }
}

function liftIcon(lift) {
    return new StatusIcon(lift["logged"].size(), lift["sets"]);
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
            app.workout.enter(id);
            var ev = new ExerciseView(id);
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

// Pick another session in the same week, or jump to the next unfinished one.
class OtherDayMenu extends WatchUi.Menu2 {
    function initialize() {
        var s = getApp().session;
        Menu2.initialize({:title => s["weekName"]});
        addItem(new WatchUi.MenuItem("Next unfinished", null, :next, null));
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
