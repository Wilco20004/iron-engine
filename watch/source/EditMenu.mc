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
    hidden var editor;

    function initialize(v, m) {
        Menu2InputDelegate.initialize();
        view = v;
        editor = new SetEditor(v, m);
    }

    function onSelect(item) {
        var id = item.getId();
        if (id == :kg) {
            editor.editKg();
        } else if (id == :reps) {
            editor.editReps();
        } else if (id == :fail) {
            view.fail = (item as WatchUi.ToggleMenuItem).isEnabled();
        }
    }
}

// Opens the kg or reps stepper for the next set. Used from the edit menu and by
// tapping the weight or reps on the exercise screen (menu is null then).
class SetEditor {
    hidden var view;
    hidden var menu;

    function initialize(v, m) {
        view = v;
        menu = m;
    }

    function editKg() {
        var kg = view.kg.toFloat();
        push(new StepperView("kg", kg == null ? 20.0 : kg, 2.5, 1, method(:onKg)));
    }

    function editReps() {
        var r = view.reps.toNumber();
        push(new StepperView("reps", r == null ? 8 : r, null, 1, method(:onReps)));
    }

    function onKg(value) as Void {
        view.kg = formatNumber(value);
        if (menu != null) {
            menu.getItem(0).setSubLabel(view.kg + " kg");
        }
    }

    function onReps(value) as Void {
        view.reps = value.toNumber().toString();
        if (menu != null) {
            menu.getItem(1).setSubLabel(view.reps);
        }
    }

    function push(stepper) {
        WatchUi.pushView(stepper, new StepperDelegate(stepper), WatchUi.SLIDE_UP);
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
