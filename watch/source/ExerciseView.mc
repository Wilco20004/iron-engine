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
    hidden var warned = false;
    hidden var timer;

    function initialize(index) {
        View.initialize();
        li = index;
        var l = lift();
        kg = l["kg"] == null ? "" : l["kg"];
        reps = l["repT"].toString();
        timer = new Timer.Timer();
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
        var c = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
        var l = lift();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        fitText(dc, cx, h * 0.17, w * 0.62, shortName(l["name"]));

        if (resting) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.30, Graphics.FONT_MEDIUM, "REST", c);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.52, Graphics.FONT_NUMBER_THAI_HOT, clock(remaining()), c);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.76, Graphics.FONT_SMALL, "Next: set " + (nextSet() + 1) + "/" + l["sets"], c);
            dc.drawText(cx, h * 0.86, Graphics.FONT_TINY, "START: skip", c);
            return;
        }

        if (allDone()) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.45, Graphics.FONT_MEDIUM, "All sets done", c);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.62, Graphics.FONT_XTINY, "Tap to go back", c);
            return;
        }

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.29, Graphics.FONT_MEDIUM, "Set " + (nextSet() + 1) + " of " + l["sets"], c);

        // Number fonts only have digits, so an empty weight shows as 0 (it is still logged empty).
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.46, Graphics.FONT_NUMBER_HOT, kg.length() > 0 ? kg : "0", c);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.60, Graphics.FONT_TINY, l["load"], c);

        dc.setColor(fail ? Graphics.COLOR_RED : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.72, Graphics.FONT_LARGE, "x " + reps + (fail ? " F" : ""), c);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.84, Graphics.FONT_SMALL, "Target " + l["reps"], c);
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.92, Graphics.FONT_XTINY, "START: done", c);

        // Side buttons: how-to on the left, photos on the right.
        var r = w * 0.075;
        dc.setPenWidth(2);
        if (hasInfo()) {
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.drawCircle(w * 0.11, h * 0.46, r);
            dc.drawText(w * 0.11, h * 0.46, Graphics.FONT_SMALL, "i", c);
        }
        if (hasPhoto()) {
            var px = w * 0.89;
            var py = h * 0.46;
            dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.drawCircle(px, py, r);
            dc.drawRectangle(px - r * 0.55, py - r * 0.4, r * 1.1, r * 0.8);
            dc.fillPolygon([[px - r * 0.45, py + r * 0.3], [px - r * 0.1, py - r * 0.15], [px + r * 0.2, py + r * 0.3]]);
            dc.fillCircle(px + r * 0.25, py - r * 0.15, r * 0.12);
        }
        dc.setPenWidth(1);
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
        getApp().logSet(li, kg, reps, fail);
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
        restEnd = System.getTimer() + secs * 1000;
        timer.start(method(:onTick), 1000, true);
        WatchUi.requestUpdate();
    }

    function onTick() as Void {
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
        timer.stop();
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
