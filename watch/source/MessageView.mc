import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Loading and problem messages. Tapping retries loading the session.
class MessageView extends WatchUi.View {
    hidden var text;
    hidden var autoLoad;

    function initialize(t, load) {
        View.initialize();
        text = t;
        autoLoad = load;
    }

    function onShow() {
        if (autoLoad) {
            autoLoad = false;
            getApp().loadSession(null, null);
        }
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var area = new WatchUi.TextArea({
            :text => text,
            :color => Graphics.COLOR_WHITE,
            :font => [Graphics.FONT_SMALL, Graphics.FONT_XTINY],
            :justification => Graphics.TEXT_JUSTIFY_CENTER,
            :locX => w * 0.15,
            :locY => h * 0.25,
            :width => w * 0.7,
            :height => h * 0.5
        });
        area.draw(dc);
    }
}

class MessageDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() {
        getApp().loadSession(null, null);
        return true;
    }

    function onTap(evt) {
        getApp().loadSession(null, null);
        return true;
    }
}
