import Toybox.Graphics;
import Toybox.Lang;

// Shared colours and drawing helpers so every screen looks like one app.
module Theme {
    const ACCENT = 0xFF8A1F;  // orange: current set, labels
    const GOOD = 0x3DDC84;    // green: rest, done, save
    const INFO = 0x4DA3FF;    // blue: info and photo buttons
    const HARD = 0xFF4D4D;    // red: hard intervals, failure
    const TEXT = 0xFFFFFF;
    const MUTED = 0x9AA0A8;   // secondary text
    const TRACK = 0x2A2E35;   // empty rings, dots, button backgrounds

    function clear(dc) {
        dc.setColor(TEXT, Graphics.COLOR_BLACK);
        dc.clear();
    }

    // Short arc at the screen edge beside the START button (upper right).
    function startHint(dc, color) {
        var w = dc.getWidth();
        dc.setPenWidth(w * 0.025);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawArc(w / 2, dc.getHeight() / 2, w / 2 - w * 0.02, Graphics.ARC_COUNTER_CLOCKWISE, 33, 57);
        dc.setPenWidth(1);
    }

    // Progress ring just inside the edge (leaving room for the START arc),
    // filling clockwise from the top.
    function ring(dc, frac, color) {
        var w = dc.getWidth();
        var cx = w / 2;
        var cy = dc.getHeight() / 2;
        var r = w / 2 - w * 0.065;
        dc.setPenWidth(w * 0.028);
        dc.setColor(TRACK, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, cy, r);
        if (frac > 0) {
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            if (frac >= 1) {
                dc.drawCircle(cx, cy, r);
            } else {
                dc.drawArc(cx, cy, r, Graphics.ARC_CLOCKWISE, 90, 90 - 360 * frac);
            }
        }
        dc.setPenWidth(1);
    }

    // A row of n dots: the first `done` filled, the next one outlined (current).
    function dots(dc, cx, y, n, done, color) {
        var w = dc.getWidth();
        var r = w * 0.016;
        var gap = w * 0.055;
        var x = cx - gap * (n - 1) / 2.0;
        for (var i = 0; i < n; i++) {
            if (i < done) {
                dc.setColor(color, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, r);
            } else if (i == done) {
                dc.setColor(TEXT, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(w * 0.008);
                dc.drawCircle(x, y, r);
                dc.setPenWidth(1);
            } else {
                dc.setColor(TRACK, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, r);
            }
            x += gap;
        }
    }

    // Round button: dark disc with a coloured label.
    function button(dc, x, y, r, label, color) {
        dc.setColor(TRACK, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x, y, r);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        var font = label.length() > 2 ? Graphics.FONT_SMALL : Graphics.FONT_MEDIUM;
        dc.drawText(x, y, font, label, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // Heart icon and live heart rate, centred on (cx, y). Nothing when there's no reading.
    function heartRate(dc, cx, y) {
        var bpm = getApp().workout.heartRate();
        if (bpm == null) {
            return;
        }
        var label = bpm.toString();
        var tw = dc.getTextWidthInPixels(label, Graphics.FONT_SMALL);
        var s = dc.getWidth() * 0.022;
        var hx = cx - tw / 2 - s * 1.4;
        dc.setColor(HARD, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(hx - s * 0.5, y - s * 0.3, s * 0.6);
        dc.fillCircle(hx + s * 0.5, y - s * 0.3, s * 0.6);
        dc.fillPolygon([[hx - s * 1.08, y - s * 0.1], [hx + s * 1.08, y - s * 0.1], [hx, y + s * 1.0]]);
        text(dc, cx + s * 0.6, y, Graphics.FONT_SMALL, TEXT, label);
    }

    // Small red dot at the top while the Garmin activity is recording.
    function recDot(dc) {
        if (getApp().workout.active()) {
            var w = dc.getWidth();
            dc.setColor(HARD, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(w / 2, dc.getHeight() * 0.075, w * 0.012);
        }
    }

    function text(dc, x, y, font, color, s) {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, s, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
