import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.WatchUi;

// Iron + Engine on the wrist: fetches the next session from the server
// (/watch/session), walks through sets with a rest timer, and uploads each
// finished set. Uploads queue up while the phone is out of reach.
class IronApp extends Application.AppBase {
    var session = null;   // Dictionary from /watch/session
    var queue = [];       // pending uploads: {"path" => "/watch/set", "body" => {...}}
    var menu = null;      // the session menu, so other screens can refresh its labels
    var status = "";      // last sync problem, shown in the menu
    hidden var _busy = false;
    hidden var _loading = false;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        var q = Application.Storage.getValue("queue");
        if (q instanceof Array) {
            queue = q;
        }
        var s = Application.Storage.getValue("session");
        if (s instanceof Dictionary) {
            session = s;
        }
    }

    function onStop(state) {
    }

    function getInitialView() {
        var view = new MessageView("Loading your session...", true);
        return [view, new MessageDelegate()];
    }

    /* ---------- settings ---------- */

    function baseUrl() {
        var u = Application.Properties.getValue("serverUrl");
        if (u == null) {
            return "";
        }
        u = u.toString();
        while (u.length() > 0 && u.substring(u.length() - 1, u.length()).equals("/")) {
            u = u.substring(0, u.length() - 1);
        }
        return u;
    }

    function watchKey() {
        var k = Application.Properties.getValue("watchKey");
        return k == null ? "" : k.toString();
    }

    function configured() {
        return baseUrl().length() > 0 && watchKey().length() > 0;
    }

    /* ---------- session ---------- */

    // week/day null = the next unfinished session.
    function loadSession(week, day) {
        if (!configured()) {
            showMessage("Enter the server address and watch key in Garmin Connect: Iron + Engine, Settings.");
            return;
        }
        if (_loading) {
            return;
        }
        _loading = true;
        var params = {};
        if (week != null) {
            params = {"week" => week, "day" => day};
        }
        Communications.makeWebRequest(baseUrl() + "/watch/session", params, {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {"X-Watch-Key" => watchKey()},
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, method(:onSession));
    }

    function onSession(code as Number, data as Dictionary or String or Null) as Void {
        _loading = false;
        if (code == 200 && data instanceof Dictionary) {
            session = data;
            Application.Storage.setValue("session", data);
            status = "";
            showSessionMenu();
            postNext();
        } else if (session != null) {
            status = code == 401 ? "Watch key not accepted" : "Offline: saved session";
            showSessionMenu();
        } else if (code == 401) {
            showMessage("Watch key not accepted. Check it in the watch app's settings.");
        } else {
            showMessage("Can't reach the server (" + code + "). Is your phone nearby? Tap to try again.");
        }
    }

    function showSessionMenu() {
        menu = new SessionMenu();
        WatchUi.switchToView(menu, new SessionMenuDelegate(), WatchUi.SLIDE_IMMEDIATE);
    }

    function showMessage(text) {
        menu = null;
        WatchUi.switchToView(new MessageView(text, false), new MessageDelegate(), WatchUi.SLIDE_IMMEDIATE);
    }

    function refreshMenu() {
        if (menu != null) {
            menu.refresh();
        }
    }

    /* ---------- logging ---------- */

    function logSet(liftIndex, kg, reps, fail) {
        var lift = session["lifts"][liftIndex];
        var logged = lift["logged"];
        var setIndex = logged.size();
        logged.add({"kg" => kg, "reps" => reps, "fail" => fail});
        lift["kg"] = kg;
        Application.Storage.setValue("session", session);
        enqueue("/watch/set", {
            "week" => session["week"], "day" => session["day"], "lift" => liftIndex,
            "set" => setIndex, "kg" => kg, "reps" => reps, "fail" => fail
        });
        refreshMenu();
    }

    function logCardio(minutes) {
        session["cardio"]["done"] = true;
        Application.Storage.setValue("session", session);
        enqueue("/watch/cardio", {"week" => session["week"], "day" => session["day"], "min" => minutes});
        refreshMenu();
    }

    /* ---------- upload queue ---------- */

    function enqueue(path, body) {
        queue.add({"path" => path, "body" => body});
        Application.Storage.setValue("queue", queue);
        postNext();
    }

    function postNext() {
        if (_busy || queue.size() == 0 || !configured()) {
            return;
        }
        _busy = true;
        var item = queue[0];
        Communications.makeWebRequest(baseUrl() + item["path"], item["body"], {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "X-Watch-Key" => watchKey(),
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, method(:onPosted));
    }

    function onPosted(code as Number, data as Dictionary or String or Null) as Void {
        _busy = false;
        // 400 means the plan changed since this set was done; drop it rather than block the queue.
        if (code == 200 || code == 400) {
            queue = queue.slice(1, null);
            Application.Storage.setValue("queue", queue);
            status = "";
            postNext();
        } else {
            status = queue.size().toString() + " waiting to upload";
        }
        refreshMenu();
    }
}

function getApp() as IronApp {
    return Application.getApp() as IronApp;
}
