use std::{ops::Deref as _, path::PathBuf};

use gpui::{IntoElement as _, TestAppContext, VisualTestContext};
use gpui_shell::ShellRuntime;

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app")
}

#[gpui::test]
fn quote_stream_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let view_type = runtime
        .load_app(&app_dir(), "quote_stream.test.js")
        .expect("load current quote stream vectors");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let view = context
        .update(|window, cx| runtime.instantiate_view(&view_type, window, cx))
        .expect("instantiate current quote stream vectors");

    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(400.), gpui::px(300.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    assert!(rendered.contains("text \"ok\""), "{rendered}");
}

#[gpui::test]
fn auth_and_http_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let view_type = runtime
        .load_app(&app_dir(), "auth_http.test.js")
        .expect("load current auth and http vectors");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let view = context
        .update(|window, cx| runtime.instantiate_view(&view_type, window, cx))
        .expect("instantiate current auth and http vectors");

    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(400.), gpui::px(300.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    assert!(rendered.contains("text \"ok\""), "{rendered}");
}

#[gpui::test]
fn chart_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    runtime
        .load_app(&app_dir(), "chart.test.js")
        .expect("current chart vectors execute in QuickJS");
}

#[gpui::test]
fn protocol_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    runtime
        .load_app(&app_dir(), "protocol.test.js")
        .expect("current protocol vectors execute in QuickJS");
}

#[gpui::test]
fn market_state_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    runtime
        .load_app(&app_dir(), "market.test.js")
        .expect("current market-state vectors execute in QuickJS");
}

#[gpui::test]
fn portfolio_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    runtime
        .load_app(&app_dir(), "portfolio.test.js")
        .expect("current portfolio vectors execute in QuickJS");
}

#[gpui::test]
fn watchlist_row_renders_scannable_market_columns(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let view_type = runtime
        .load_app(&app_dir(), "watchlist_ui.test.js")
        .expect("load current Watchlist UI probe");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let view = context
        .update(|window, cx| runtime.instantiate_view(&view_type, window, cx))
        .expect("instantiate current Watchlist UI probe");
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(900.), gpui::px(300.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    for expected in [
        "Instrument",
        "Last",
        "Change",
        "Volume",
        "Session",
        "Apple",
        "text \"AAPL\"",
        "188.00",
        "+4.44%",
        "8.59B",
        "Trading",
        "Previous close",
        "Open",
        "Day range",
        "Turnover",
        "Last market update",
        "Data health",
        "181.00 — 190.25",
        "1.59B",
        "Live · 5s ago",
    ] {
        assert!(
            rendered.contains(expected),
            "missing {expected}:\n{rendered}"
        );
    }
    assert!(!rendered.contains("text \"US · AAPL\""), "{rendered}");
    assert!(
        rendered.contains(".font_family[Str(\"monospace\")]"),
        "{rendered}"
    );

    // A popup trigger draws its own open state. Styling it from focus alone
    // reads backwards: the surface holds the keyboard while it is up, so the
    // trigger would go flat exactly while the menu is showing.
    let closed = rendered
        .lines()
        .find(|line| line.contains("probe-menu-closed"))
        .expect("closed trigger");
    let open = rendered
        .lines()
        .find(|line| line.contains("probe-menu-open"))
        .expect("open trigger");
    assert!(!closed.contains(":selected[Bool(true)]"), "{closed}");
    assert!(open.contains(":selected[Bool(true)]"), "{open}");
    assert_ne!(
        closed.split(".bg[").nth(1),
        open.split(".bg[").nth(1),
        "an open trigger must not paint like a closed one"
    );

    // And focus must not paint like open. A Popover hands the keyboard back to
    // its trigger when it dismisses, so a focus style that fills the control
    // the way `open` does leaves a closed menu looking open.
    let focus = closed
        .split(":focus(")
        .nth(1)
        .expect("closed trigger has a focus style");
    let focus = &focus[..focus.find(')').expect("focus style ends")];
    assert!(
        !focus.contains(".bg["),
        "focus must not change the trigger's fill: {focus}"
    );
}

#[gpui::test]
fn authenticated_workspace_materializes_a_scrollable_watchlist(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let view_type = runtime
        .load_app(&app_dir(), "workspace_ui.test.js")
        .expect("load authenticated workspace UI probe");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let view = context
        .update(|window, cx| runtime.instantiate_view(&view_type, window, cx))
        .expect("instantiate authenticated workspace UI probe");

    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(1120.), gpui::px(760.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    // The rows are not in this tree, and that is the point of the change: a
    // virtual list describes itself and its item count, and its rows are built
    // during layout for the range on screen. `watchlist_ui.test.js` covers what
    // one row draws.
    assert!(
        rendered.contains("v_virtual_list \"watchlist-rows\" \u{00d7}12"),
        "{rendered}"
    );
    assert!(
        rendered.contains("Scrollbar \"watchlist-rows\""),
        "{rendered}"
    );
    assert!(!rendered.contains("Test security 12"), "{rendered}");

    // Both panes are panels of one resizable group rather than wrapped flex
    // children, so the divider between them is base's and its position is the
    // window's.
    assert!(
        rendered.contains("h_resizable \"watchlist-workspace\""),
        "{rendered}"
    );
    assert!(rendered.contains("resizable_panel"), "{rendered}");
    assert!(rendered.contains("watchlist-pane"), "{rendered}");
    assert!(rendered.contains("stock-detail-pane"), "{rendered}");

    // The Watchlist popup menu and the column tooltips.
    assert!(rendered.contains("Popover"), "{rendered}");
    assert!(rendered.contains("watchlist-menu-trigger"), "{rendered}");
    assert!(rendered.contains(":tooltip"), "{rendered}");

    assert!(rendered.contains("5D intraday"), "{rendered}");
    assert!(rendered.contains("path fill"), "{rendered}");
    assert!(rendered.contains("path stroke"), "{rendered}");
    assert!(rendered.contains(":overflow_y_scrollbar"), "{rendered}");
}

#[gpui::test]
fn allocation_donut_folds_past_the_palette_and_uses_no_other_colours(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let view_type = runtime
        .load_app(&app_dir(), "allocation_ui.test.js")
        .expect("load allocation chart probe");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let view = context
        .update(|window, cx| runtime.instantiate_view(&view_type, window, cx))
        .expect("instantiate allocation chart probe");
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(640.), gpui::px(400.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    // Seven priced positions, six wedges: the two smallest are one remainder.
    assert_eq!(
        rendered.matches("path fill").count(),
        6,
        "expected six wedges:\n{rendered}"
    );
    assert!(
        rendered.contains("Other (2 positions)"),
        "the folded tail is named:\n{rendered}"
    );
    assert!(rendered.contains("Alpha"), "{rendered}");
    assert!(
        !rendered.contains("Zeta") && !rendered.contains("Eta"),
        "folded holdings leave the legend:\n{rendered}"
    );

    // The five hues in ranked order, and nothing outside them. The remainder
    // takes the muted-foreground token rather than a sixth hue.
    for hue in ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] {
        assert!(rendered.contains(hue), "missing {hue}:\n{rendered}");
    }
    for retired in ["#16a34a", "#2563eb", "#d97706", "#7c3aed", "#0891b2"] {
        assert!(
            !rendered.contains(retired),
            "retired allocation colour {retired} is still drawn:\n{rendered}"
        );
    }
}

#[gpui::test]
fn portfolio_renders_pnl_summary_and_position_columns(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let view_type = runtime
        .load_app(&app_dir(), "portfolio_ui.test.js")
        .expect("load Portfolio UI probe");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let view = context
        .update(|window, cx| runtime.instantiate_view(&view_type, window, cx))
        .expect("instantiate Portfolio UI probe");
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(900.), gpui::px(600.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    for expected in [
        "Portfolio summary",
        "Net assets",
        "Today's P/L",
        "Total P/L",
        "Asset allocation",
        "Allocation",
        "Apple",
        "100.0%",
        "+30.00 USD",
        "+80.00 USD",
        "Last / Cost",
        "+4.44%",
        ".font_family[Str(\"monospace\")]",
    ] {
        assert!(
            rendered.contains(expected),
            "missing {expected}:\n{rendered}"
        );
    }
    assert!(rendered.contains("Table \"allocation-USD\""), "{rendered}");
    assert!(rendered.contains("path fill"), "{rendered}");

    // One scroll for the whole column, and no panel claiming the leftover
    // height: a short window scrolls to Holdings rather than crushing it.
    assert_eq!(
        rendered.matches(":overflow_y_scroll[]").count(),
        1,
        "expected exactly one scroll container:\n{rendered}"
    );
    assert!(
        !rendered.contains(":overflow_y_scrollbar"),
        "no panel scrolls inside the page scroll:\n{rendered}"
    );
    // The explanatory Popover beside the chart, distinct from the Watchlist menu.
    assert!(rendered.contains("Popover \"allocation-help\""), "{rendered}");
    assert!(rendered.contains("allocation-help-trigger"), "{rendered}");
}

struct Empty;

impl gpui::Render for Empty {
    fn render(
        &mut self,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        gpui::div()
    }
}
