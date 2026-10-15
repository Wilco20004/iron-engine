import Toybox.Attention;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// One exercise: shows the next set (kg x reps), logs it on tap or START,
// then runs the rest countdown with vibrations.
class ExerciseView extends WatchUi.View {
    var li;
    var kg = "";
    var reps = "";
    var fail = false;
    var resting = false;
    hidden var restEnd = 0;
    hidden var restTotal = 0;
    hidden var warned = false;
    hidden var timer;
    hidden var setStart = 0;   // when the current set began (exercise opened or rest ended)
    hidden var peakHr = 0;     // highest heart rate seen during the current set
    hidden var flash = "";     // "+15 s" after a swipe changed the rest
    hidden var flashUntil = 0;

    function initialize(index) {
        View.initialize();
        li = index;
        var l = lift();
        kg = l["kg"] == null ? "" : l["kg"];
        reps = l["repT"].toString();
        beginSet();
        // One tick a second: counts the rest down, or samples heart rate during a set.
        timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
    }

    function beginSet() {
        setStart = System.getTimer();
        peakHr = 0;
    }

    function sampleHr() {
        var hr = getApp().workout.heartRate();
        if (hr != null && hr > peakHr) {
            peakHr = hr;
        }
    }

    function lift() {
        return getApp().session["lifts"][li];
    }

    function nextSet() {
        return lift()["logged"].size();
    }

    function allDone() {
        return nextSet() >= lift()["sets"];
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var l = lift();
        Theme.clear(dc);

        if (resting) {
            var left = remaining();
            var color = left <= 10 ? Theme.ACCENT : Theme.GOOD;
            Theme.ring(dc, restTotal > 0 ? left.toFloat() / restTotal : 0, color);
            Theme.startHint(dc, Theme.TEXT);
            // A swipe that changed the rest shows "+15 s" / "-15 s" here for a moment.
            var label = System.getTimer() < flashUntil ? flash : "REST";
            Theme.text(dc, cx, h * 0.20, Graphics.FONT_SMALL, color, label);
            Theme.text(dc, cx, h * 0.38, Graphics.FONT_NUMBER_HOT, Theme.TEXT, clock(left));
            Theme.heartRate(dc, cx, h * 0.54);
            // Both lines open an editor when tapped: fix the set just done, or plan the next.
            Theme.text(dc, cx, h * 0.665, Graphics.FONT_SMALL, Theme.MUTED, "Last  " + setLabel(lastSet()));
            Theme.text(dc, cx, h * 0.775, Graphics.FONT_SMALL, Theme.TEXT, "Next  " + setLabel({"kg" => kg, "reps" => reps, "fail" => fail}));
            Theme.dots(dc, cx, h * 0.88, l["sets"], nextSet(), Theme.ACCENT);
            return;
        }

        Theme.recDot(dc);
        dc.setColor(Theme.MUTED, Graphics.COLOR_TRANSPARENT);
        fitText(dc, cx, h * 0.17, w * 0.54, shortName(l["name"]));

        if (allDone()) {
            Theme.ring(dc, 1, Theme.GOOD);
            Theme.text(dc, cx, h * 0.40, Graphics.FONT_LARGE, Theme.GOOD, "Done");
            Theme.dots(dc, cx, h * 0.53, l["sets"], l["sets"], Theme.GOOD);
            Theme.text(dc, cx, h * 0.665, Graphics.FONT_SMALL, Theme.MUTED, "Last  " + setLabel(lastSet()));
            Theme.text(dc, cx, h * 0.80, Graphics.FONT_XTINY, Theme.MUTED, "Tap to go back");
            return;
        }

        Theme.dots(dc, cx, h * 0.28, l["sets"], nextSet(), Theme.ACCENT);

        // No weight yet (or a bodyweight exercise): show "--" until one is entered.
        if (kg.length() > 0) {
            Theme.text(dc, cx, h * 0.45, Graphics.FONT_NUMBER_HOT, Theme.TEXT, kg);
        } else {
            Theme.text(dc, cx, h * 0.45, Graphics.FONT_LARGE, Theme.MUTED, "--");
        }
        Theme.text(dc, cx, h * 0.59, Graphics.FONT_TINY, Theme.MUTED, l["load"]);
        Theme.text(dc, cx, h * 0.71, Graphics.FONT_LARGE, fail ? Theme.HARD : Theme.TEXT, "x " + reps + (fail ? " F" : ""));
        Theme.text(dc, cx, h * 0.83, Graphics.FONT_SMALL, Theme.ACCENT, "Target " + l["reps"]);

        Theme.startHint(dc, Theme.GOOD);

        // Side buttons: how-to on the left, photos on the right.
        var r = w * 0.07;
        if (hasInfo()) {
            Theme.button(dc, w * 0.11, h * 0.45, r, "i", Theme.INFO);
        }
        if (hasPhoto()) {
            var px = w * 0.89;
            var py = h * 0.45;
            dc.setColor(Theme.TRACK, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(px, py, r);
            dc.setColor(Theme.INFO, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            dc.drawRectangle(px - r * 0.55, py - r * 0.4, r * 1.1, r * 0.8);
            dc.setPenWidth(1);
            dc.fillPolygon([[px - r * 0.45, py + r * 0.3], [px - r * 0.1, py - r * 0.15], [px + r * 0.2, py + r * 0.3]]);
            dc.fillCircle(px + r * 0.25, py - r * 0.15, r * 0.12);
        }
    }

    function lastSet() {
        var logged = lift()["logged"];
        return logged.size() > 0 ? logged[logged.size() - 1] : null;
    }

    // "40 x 8", "x 12" (no weight), "40 x 6 F" (to failure)
    function setLabel(s) {
        if (s == null) {
            return "-";
        }
        var k = s["kg"] == null ? "" : s["kg"].toString();
        return (k.length() > 0 ? k + " x " : "x ") + s["reps"] + (s["fail"] == true ? " F" : "");
    }

    // Called by the edit menu and keypad after the next set's values change.
    function changed() {
        WatchUi.requestUpdate();
    }

    function hasInfo() {
        var s = lift()["steps"];
        return s instanceof Array && s.size() > 0;
    }

    function hasPhoto() {
        var p = lift()["photo"];
        return p != null && p.length() > 0;
    }

    // Tap / START: finish the set, skip the rest, or leave when all sets are done.
    function primary() {
        if (resting) {
            endRest();
            return;
        }
        if (allDone()) {
            stop();
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return;
        }
        sampleHr();
        getApp().logSet(li, kg, reps, fail, (System.getTimer() - setStart) / 1000, peakHr);
        fail = false;
        if (allDone()) {
            buzz(2);
            WatchUi.requestUpdate();
            return;
        }
        startRest(lift()["rest"]);
    }

    // While resting: +15 s or -15 s (so an accidental swipe can be undone), never
    // below 5 s left; only START ends the rest early.
    function changeRest(delta) {
        var now = System.getTimer();
        var end = restEnd + delta * 1000;
        if (end < now + 5000) {
            end = now + 5000;
        }
        restTotal += (end - restEnd) / 1000;
        restEnd = end;
        if (remaining() > 10) {
            warned = false;
        }
        flash = (delta > 0 ? "+" : "-") + delta.abs() + " s";
        flashUntil = now + 1500;
        WatchUi.requestUpdate();
    }

    function changeReps(delta) {
        var r = reps.toNumber();
        if (r == null) {
            r = 0;
        }
        r += delta;
        if (r < 0) {
            r = 0;
        }
        reps = r.toString();
        WatchUi.requestUpdate();
    }

    function startRest(secs) {
        resting = true;
        warned = false;
        restTotal = secs;
        restEnd = System.getTimer() + secs * 1000;
        WatchUi.requestUpdate();
    }

    function onTick() as Void {
        if (!resting) {
            sampleHr();
            return;
        }
        var left = remaining();
        if (!warned && left <= 10 && left > 0) {
            warned = true;
            buzz(1);
        }
        if (left <= 0) {
            endRest();
            buzz(3);
        }
        WatchUi.requestUpdate();
    }

    function endRest() {
        resting = false;
        beginSet();
        WatchUi.requestUpdate();
    }

    function stop() {
        timer.stop();
    }

    function remaining() {
        var ms = restEnd - System.getTimer();
        return ms <= 0 ? 0 : (ms + 999) / 1000;
    }
}

class ExerciseDelegate extends WatchUi.BehaviorDelegate {
    hidden var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    // A screen tap also arrives as onSelect. Declining it here lets the tap reach
    // onTap and the START key reach onKey, so only the key logs a set.
    function onSelect() {
        return false;
    }

    function onKey(evt) {
        if (evt.getKey() == WatchUi.KEY_ENTER) {
            view.primary();
            return true;
        }
        return false;
    }

    // Taps only ever edit, so a stray touch can't log a set or skip the rest;
    // START does both. Tap the weight or reps to change it, anywhere else for the menu.
    // While resting, "Last" fixes the set just done and "Next" edits the coming one;
    // the rest of the screen ignores taps.
    function onTap(evt) {
        var xy = evt.getCoordinates();
        var s = System.getDeviceSettings();
        var x = xy[0].toFloat() / s.screenWidth;
        var y = xy[1].toFloat() / s.screenHeight;
        var onLast = y >= 0.61 && y < 0.72 && view.lastSet() != null;
        if (view.resting) {
            if (onLast) {
                fixLast();
            } else if (y >= 0.72 && y < 0.84) {
                openEdit();
            }
            return true;
        }
        if (view.allDone()) {
            if (onLast) {
                fixLast();
            } else {
                view.primary();
            }
            return true;
        }
        if (y > 0.34 && y < 0.60 && x < 0.22 && view.hasInfo()) {
            var info = new InfoView(view.lift());
            WatchUi.pushView(info, new InfoDelegate(info), WatchUi.SLIDE_LEFT);
        } else if (y > 0.34 && y < 0.60 && x > 0.78 && view.hasPhoto()) {
            var photo = new PhotoView(view.lift()["photo"]);
            WatchUi.pushView(photo, new PhotoDelegate(photo), WatchUi.SLIDE_LEFT);
        } else if (y > 0.36 && y < 0.66) {
            new SetEditor(view, null).editKg();
        } else if (y >= 0.66 && y < 0.79) {
            new SetEditor(view, null).editReps();
        } else {
            openEdit();
        }
        return true;
    }

    function onMenu() {
        if (!view.allDone()) {
            openEdit();
        }
        return true;
    }

    // Swipe up / down button: reps -1, or +15 s of rest.
    // Swipe down / up button: reps +1, or -15 s of rest (undoes an accidental swipe up).
    function onNextPage() {
        if (view.resting) {
            view.changeRest(15);
        } else {
            view.changeReps(-1);
        }
        return true;
    }

    function onPreviousPage() {
        if (view.resting) {
            view.changeRest(-15);
        } else {
            view.changeReps(1);
        }
        return true;
    }

    function onBack() {
        view.stop();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    function openEdit() {
        var menu = new EditMenu(view, "Next set");
        WatchUi.pushView(menu, new EditMenuDelegate(view, menu), WatchUi.SLIDE_UP);
    }

    function fixLast() {
        var n = view.nextSet();
        var set = new LoggedSet(view.li, n - 1);
        var menu = new EditMenu(set, "Fix set " + n);
        WatchUi.pushView(menu, new EditMenuDelegate(set, menu), WatchUi.SLIDE_UP);
    }
}

function shorten(text, max) {
    return text.length() > max ? text.substring(0, max - 1) + "." : text;
}

// "Pull-up (weighted or assisted)" -> "Pull-up": the brackets don't fit a round screen.
function shortName(name) {
    var i = name.find(" (");
    return shorten(i == null ? name : name.substring(0, i), 26);
}

// Draws one centred line in the largest font that fits maxWidth.
function fitText(dc, x, y, maxWidth, text) {
    var fonts = [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY];
    var font = Graphics.FONT_XTINY;
    for (var i = 0; i < fonts.size(); i++) {
        if (dc.getTextWidthInPixels(text, fonts[i]) <= maxWidth) {
            font = fonts[i];
            break;
        }
    }
    dc.drawText(x, y, font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
}

function clock(secs) {
    return (secs / 60).format("%d") + ":" + (secs % 60).format("%02d");
}

// 1: short (10 s left), 2: double (exercise done / hard interval), 3: long (rest over).
function buzz(kind) {
    if (Attention has :vibrate) {
        var pattern;
        if (kind == 1) {
            pattern = [new Attention.VibeProfile(50, 200)];
        } else if (kind == 2) {
            pattern = [new Attention.VibeProfile(100, 300), new Attention.VibeProfile(0, 150), new Attention.VibeProfile(100, 300)];
        } else {
            pattern = [new Attention.VibeProfile(100, 800)];
        }
        Attention.vibrate(pattern);
    }
    if (kind == 3 && Attention has :backlight) {
        try {
            Attention.backlight(true);
        } catch (e) {
        }
    }
}
