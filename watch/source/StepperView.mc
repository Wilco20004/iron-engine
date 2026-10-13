import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Big-button number editor for the next set's kg or reps: tap - / + on either
// side or swipe right / left, START (or tap the bottom) saves, the Back button
// cancels. Weight has two rows of steps (2.5 and 1 kg); reps one (1).
class StepperView extends WatchUi.View {
    var value;
    var big;
    var small;
    hidden var label;
    hidden var callback;

    function initialize(lbl, v, bigStep, smallStep, cb) {
        View.initialize();
        label = lbl;
        value = v;
        big = bigStep;
        small = smallStep;
        callback = cb;
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var c = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.13, Graphics.FONT_SMALL, label, c);

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        if (big != null) {
            dc.drawText(w * 0.28, h * 0.30, Graphics.FONT_MEDIUM, "-" + formatNumber(big), c);
            dc.drawText(w * 0.72, h * 0.30, Graphics.FONT_MEDIUM, "+" + formatNumber(big), c);
        }
        dc.drawText(w * 0.28, h * 0.72, Graphics.FONT_MEDIUM, "-" + formatNumber(small), c);
        dc.drawText(w * 0.72, h * 0.72, Graphics.FONT_MEDIUM, "+" + formatNumber(small), c);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.50, Graphics.FONT_NUMBER_HOT, formatNumber(value), c);

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.88, Graphics.FONT_SMALL, "Save", c);
    }

    function adjust(delta) {
        value += delta;
        if (value < 0) {
            value = 0;
        }
        WatchUi.requestUpdate();
    }

    function save() {
        callback.invoke(value);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}

class StepperDelegate extends WatchUi.BehaviorDelegate {
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

    // Swipe right: + small step, left: - small step (same sides as the buttons).
    function onSwipe(evt) {
        var dir = evt.getDirection();
        if (dir == WatchUi.SWIPE_RIGHT) {
            view.adjust(view.small);
            return true;
        }
        if (dir == WatchUi.SWIPE_LEFT) {
            view.adjust(-view.small);
            return true;
        }
        return false;
    }

    function onTap(evt) {
        var xy = evt.getCoordinates();
        var s = System.getDeviceSettings();
        var x = xy[0].toFloat() / s.screenWidth;
        var y = xy[1].toFloat() / s.screenHeight;
        var sign = x < 0.5 ? -1 : 1;
        if (y >= 0.82) {
            view.save();
        } else if (y < 0.42 && view.big != null) {
            view.adjust(sign * view.big);
        } else if (y > 0.58) {
            view.adjust(sign * view.small);
        }
        return true;
    }

    // Buttons: up / down change by the small step.
    function onNextPage() {
        view.adjust(-view.small);
        return true;
    }

    function onPreviousPage() {
        view.adjust(view.small);
        return true;
    }

    // Swipe right also arrives as onBack; declining it lets the swipe reach onSwipe
    // and the Back button reach onKey.
    function onBack() {
        return false;
    }
}
