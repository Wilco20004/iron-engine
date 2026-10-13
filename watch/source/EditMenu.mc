import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Change the weight or reps for the next set, or mark it as taken to failure.
class EditMenu extends WatchUi.Menu2 {
    function initialize(view) {
        Menu2.initialize({:title => "This set"});
        addItem(new WatchUi.MenuItem("Weight", view.kg.length() > 0 ? view.kg + " kg" : "none", :kg, null));
        addItem(new WatchUi.MenuItem("Reps", view.reps, :reps, null));
        addItem(new WatchUi.ToggleMenuItem("To failure", null, :fail, view.fail, null));
    }
}

class EditMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var view;
    hidden var menu;

    function initialize(v, m) {
        Menu2InputDelegate.initialize();
        view = v;
        menu = m;
    }

    function onSelect(item) {
        var id = item.getId();
        if (id == :kg) {
            var kg = view.kg.toFloat();
            var f = new NumberFactory(0.0, 0.5, 601);
            pushPicker("kg", f, f.indexOf(kg == null ? 20.0 : kg), method(:onKg));
        } else if (id == :reps) {
            var r = view.reps.toNumber();
            var f2 = new NumberFactory(0, 1, 181);
            pushPicker("reps", f2, f2.indexOf(r == null ? 8 : r), method(:onReps));
        } else if (id == :fail) {
            view.fail = (item as WatchUi.ToggleMenuItem).isEnabled();
        }
    }

    function onKg(value) as Void {
        view.kg = formatNumber(value);
        menu.getItem(0).setSubLabel(view.kg + " kg");
    }

    function onReps(value) as Void {
        view.reps = value.toNumber().toString();
        menu.getItem(1).setSubLabel(view.reps);
    }

    function pushPicker(label, factory, index, callback) {
        var title = new WatchUi.Text({
            :text => label, :color => Graphics.COLOR_WHITE, :font => Graphics.FONT_SMALL,
            :locX => WatchUi.LAYOUT_HALIGN_CENTER, :locY => WatchUi.LAYOUT_VALIGN_BOTTOM
        });
        var picker = new WatchUi.Picker({:title => title, :pattern => [factory], :defaults => [index]});
        WatchUi.pushView(picker, new ValuePickerDelegate(callback), WatchUi.SLIDE_UP);
    }
}

class NumberFactory extends WatchUi.PickerFactory {
    hidden var start;
    hidden var step;
    hidden var count;

    function initialize(s, st, n) {
        PickerFactory.initialize();
        start = s;
        step = st;
        count = n;
    }

    function getSize() {
        return count;
    }

    function getValue(index) {
        return start + index * step;
    }

    function getDrawable(index, selected) {
        return new WatchUi.Text({
            :text => formatNumber(getValue(index)), :color => Graphics.COLOR_WHITE,
            :font => Graphics.FONT_NUMBER_MEDIUM,
            :locX => WatchUi.LAYOUT_HALIGN_CENTER, :locY => WatchUi.LAYOUT_VALIGN_CENTER
        });
    }

    function indexOf(value) {
        var i = ((value - start) / step + 0.5).toNumber();
        if (i < 0) {
            return 0;
        }
        return i >= count ? count - 1 : i;
    }
}

class ValuePickerDelegate extends WatchUi.PickerDelegate {
    hidden var callback;

    function initialize(cb) {
        PickerDelegate.initialize();
        callback = cb;
    }

    function onAccept(values) {
        callback.invoke(values[0]);
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onCancel() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}

// 40.0 -> "40", 42.5 -> "42.5"
function formatNumber(value) {
    var f = value.toFloat();
    if (f == f.toNumber().toFloat()) {
        return f.toNumber().toString();
    }
    return f.format("%.1f");
}
