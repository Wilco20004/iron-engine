import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

// Number entry laid out like a clock face: 0 at the top, 1-9 where the hours
// are, then "." (weight only) and delete. The first key replaces the old value,
// so reps 8 is one tap and 42.5 kg four. Save (or START) keeps it, Back cancels.
class KeypadView extends WatchUi.View {
    var decimals;
    hidden var label;
    hidden var text;
    hidden var fresh = true;   // the next key replaces the old value
    hidden var callback;

    function initialize(lbl, value, allowDot, cb) {
        View.initialize();
        label = lbl;
        text = value;
        decimals = allowDot;
        callback = cb;
    }

    // Key at clock position i (0 = top, clockwise): "0".."9", ".", "<".
    function keyLabel(i) {
        if (i <= 9) {
            return i.toString();
        }
        if (i == 10) {
            return decimals ? "." : "";
        }
        return "<";
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;
        Theme.clear(dc);

        var rr = w * 0.385;
        var kr = w * 0.078;
        for (var i = 0; i < 12; i++) {
            var k = keyLabel(i);
            if (k.length() == 0) {
                continue;
            }
            var a = Math.toRadians(i * 30);
            var x = cx + rr * Math.sin(a);
            var y = cy - rr * Math.cos(a);
            if (i == 11) {
                Theme.button(dc, x, y, kr, "", Theme.HARD);
                deleteGlyph(dc, x, y, kr * 0.55);
            } else {
                Theme.button(dc, x, y, kr, k, Theme.TEXT);
            }
        }

        Theme.text(dc, cx, cy - w * 0.17, Graphics.FONT_XTINY, Theme.MUTED, label);
        if (text.length() == 0) {
            Theme.text(dc, cx, cy - w * 0.03, Graphics.FONT_LARGE, Theme.MUTED, "--");
        } else {
            Theme.text(dc, cx, cy - w * 0.03, Graphics.FONT_NUMBER_MILD, fresh ? Theme.MUTED : Theme.TEXT, text);
        }
        Theme.text(dc, cx, cy + w * 0.15, Graphics.FONT_SMALL, Theme.GOOD, "Save");
        Theme.startHint(dc, Theme.GOOD);
    }

    // A left-pointing "delete" tag with an x in it.
    function deleteGlyph(dc, x, y, s) {
        dc.setColor(Theme.HARD, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        var pts = [[x - s, y], [x - s * 0.4, y - s * 0.6], [x + s, y - s * 0.6], [x + s, y + s * 0.6], [x - s * 0.4, y + s * 0.6]];
        for (var i = 0; i < pts.size(); i++) {
            var p = pts[i];
            var q = pts[(i + 1) % pts.size()];
            dc.drawLine(p[0], p[1], q[0], q[1]);
        }
        dc.drawLine(x - s * 0.05, y - s * 0.3, x + s * 0.55, y + s * 0.3);
        dc.drawLine(x - s * 0.05, y + s * 0.3, x + s * 0.55, y - s * 0.3);
        dc.setPenWidth(1);
    }

    function press(i) {
        var k = keyLabel(i);
        if (k.length() == 0) {
            return;
        }
        if (fresh) {
            fresh = false;
            text = "";
        }
        if (i == 11) {
            if (text.length() > 0) {
                text = text.substring(0, text.length() - 1);
            }
        } else if (k.equals(".")) {
            if (text.find(".") == null) {
                text = (text.length() == 0 ? "0" : text) + ".";
            }
        } else {
            var dot = text.find(".");
            if (dot != null && text.length() - dot > 1) {
                return;   // one decimal is enough (42.5)
            }
            if (text.equals("0")) {
                text = "";
            }
            if (text.length() < (decimals ? 5 : 3)) {
                text += k;
            }
        }
        WatchUi.requestUpdate();
    }

    function save() {
        var t = text;
        if (t.length() > 0 && t.substring(t.length() - 1, t.length()).equals(".")) {
            t = t.substring(0, t.length() - 1);
        }
        callback.invoke(t);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}

class KeypadDelegate extends WatchUi.BehaviorDelegate {
    hidden var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    // Taps also arrive as onSelect; declining lets them reach onTap (see ExerciseDelegate).
    function onSelect() {
        return false;
    }

    function onKey(evt) {
        var key = evt.getKey();
        if (key == WatchUi.KEY_ENTER) {
            view.save();
            return true;
        }
        if (key == WatchUi.KEY_ESC) {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            return true;
        }
        return false;
    }

    // Keys sit on a ring; the middle is Save. A tap goes to the nearest key.
    function onTap(evt) {
        var xy = evt.getCoordinates();
        var s = System.getDeviceSettings();
        var dx = xy[0] - s.screenWidth / 2.0;
        var dy = xy[1] - s.screenHeight / 2.0;
        var dist = Math.sqrt(dx * dx + dy * dy) / s.screenWidth;
        if (dist > 0.27) {
            var deg = Math.toDegrees(Math.atan2(dx, -dy));
            if (deg < 0) {
                deg += 360;
            }
            view.press(((deg + 15) / 30).toNumber() % 12);
        } else if (dist < 0.22 && dy > 0) {
            view.save();
        }
        return true;
    }

    // Swipes would only be accidents here: ignore them.
    function onSwipe(evt) {
        return true;
    }

    function onNextPage() {
        return true;
    }

    function onPreviousPage() {
        return true;
    }

    // Swipe right also arrives as onBack; declining it lets the Back button reach onKey.
    function onBack() {
        return false;
    }
}
