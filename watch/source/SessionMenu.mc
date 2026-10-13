import Toybox.Lang;
import Toybox.WatchUi;

// Today's session: one row per exercise, then cardio, another day, and sync.
class SessionMenu extends WatchUi.Menu2 {
    function initialize() {
        var s = getApp().session;
        Menu2.initialize({:title => s["title"]});
        var lifts = s["lifts"];
        for (var i = 0; i < lifts.size(); i++) {
            addItem(new WatchUi.MenuItem(lifts[i]["name"], liftSubLabel(lifts[i]), i, null));
        }
        addItem(new WatchUi.MenuItem("Cardio", cardioSubLabel(), :cardio, null));
        addItem(new WatchUi.MenuItem("Other day", s["weekName"], :other, null));
        addItem(new WatchUi.MenuItem("Sync", syncSubLabel(), :sync, null));
    }

    function refresh() {
        var lifts = getApp().session["lifts"];
        for (var i = 0; i < lifts.size(); i++) {
            var item = getItem(i);
            if (item != null) {
                item.setSubLabel(liftSubLabel(lifts[i]));
            }
        }
        var cardio = getItem(lifts.size());
        if (cardio != null) {
            cardio.setSubLabel(cardioSubLabel());
        }
        var sync = getItem(lifts.size() + 2);
        if (sync != null) {
            sync.setSubLabel(syncSubLabel());
        }
        WatchUi.requestUpdate();
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
            var cv = new CardioView();
            WatchUi.pushView(cv, new CardioDelegate(cv), WatchUi.SLIDE_LEFT);
        } else if (id == :other) {
            WatchUi.pushView(new OtherDayMenu(), new OtherDayDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :sync) {
            app.postNext();
            app.loadSession(app.session["week"], app.session["day"]);
        } else {
            var ev = new ExerciseView(id);
            WatchUi.pushView(ev, new ExerciseDelegate(ev), WatchUi.SLIDE_LEFT);
        }
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
