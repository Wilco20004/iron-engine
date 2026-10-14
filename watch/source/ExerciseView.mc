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
            Theme.text(dc, cx, h * 0.24, Graphics.FONT_SMALL, color, "REST");
            Theme.text(dc, cx, h * 0.47, Graphics.FONT_NUMBER_THAI_HOT, Theme.TEXT, clock(left));
            Theme.heartRate(dc, cx, h * 0.69);
            Theme.text(dc, cx, h * 0.78, Graphics.FONT_SMALL, Theme.MUTED, "Next  " + (kg.length() > 0 ? kg + " x " : "x ") + reps);
            Theme.dots(dc, cx, h * 0.87, l["sets"], nextSet(), Theme.ACCENT);
            return;
        }

        Theme.recDot(dc);
        dc.setColor(Theme.MUTED, Graphics.COLOR_TRANSPARENT);
        fitText(dc, cx, h * 0.17, w * 0.54, shortName(l["name"]));

        if (allDone()) {
            Theme.ring(dc, 1, Theme.GOOD);
            Theme.text(dc, cx, h * 0.45, Graphics.FONT_LARGE, Theme.GOOD, "Done");
            Theme.dots(dc, cx, h * 0.58, l["sets"], l["sets"], Theme.GOOD);
            Theme.text(dc, cx, h * 0.72, Graphics.FONT_SMALL, Theme.MUTED, "Tap to go back");
            return;
        }

        Theme.dots(dc, cx, h * 0.28, l["sets"], nextSet(), Theme.ACCENT);

        // Number fonts only have digits, so an empty weight shows as 0 (it is still logged empty).
        Theme.text(dc, cx, h * 0.45, Graphics.FONT_NUMBER_HOT, Theme.TEXT, kg.length() > 0 ? kg : "0");
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

    function changeReps(delta) {
        if (resting) {
            if (delta > 0) {
                restEnd += 15000;
                restTotal += 15;
                WatchUi.requestUpdate();
            }
            return;
        }
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
    function onTap(evt) {
        if (view.resting) {
            return true;
        }
        if (view.allDone()) {
            view.primary();
            return true;
        }
        var xy = evt.getCoordinates();
        var s = System.getDeviceSettings();
        var x = xy[0].toFloat() / s.screenWidth;
        var y = xy[1].toFloat() / s.screenHeight;
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
        if (!view.resting) {
            openEdit();
        }
        return true;
    }

    // Swipe up / down button: reps -1 (or +15 s of rest). Swipe down / up button: reps +1.
    function onNextPage() {
        view.changeReps(view.resting ? 1 : -1);
        return true;
    }

    function onPreviousPage() {
        view.changeReps(1);
        return true;
    }

    function onBack() {
        view.stop();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    function openEdit() {
        var menu = new EditMenu(view);
        WatchUi.pushView(menu, new EditMenuDelegate(view, menu), WatchUi.SLIDE_UP);
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
