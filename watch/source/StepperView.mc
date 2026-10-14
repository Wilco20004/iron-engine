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
        Theme.clear(dc);

        Theme.text(dc, w / 2, h * 0.12, Graphics.FONT_SMALL, Theme.MUTED, label);

        var r = w * 0.105;
        if (big != null) {
            Theme.button(dc, w * 0.30, h * 0.28, r, "-" + formatNumber(big), Theme.ACCENT);
            Theme.button(dc, w * 0.70, h * 0.28, r, "+" + formatNumber(big), Theme.ACCENT);
        }
        Theme.button(dc, w * 0.30, h * 0.72, r, "-" + formatNumber(small), Theme.ACCENT);
        Theme.button(dc, w * 0.70, h * 0.72, r, "+" + formatNumber(small), Theme.ACCENT);

        Theme.text(dc, w / 2, h * 0.50, Graphics.FONT_NUMBER_HOT, Theme.TEXT, formatNumber(value));

        Theme.text(dc, w / 2, h * 0.90, Graphics.FONT_SMALL, Theme.GOOD, "Save");
        Theme.startHint(dc, Theme.GOOD);
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
