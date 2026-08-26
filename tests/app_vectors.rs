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
        "Regular",
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
    assert!(rendered.contains(".font_family[Str(\"monospace\")]"), "{rendered}");
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

    assert!(rendered.contains("TEST00.US"), "{rendered}");
    assert!(rendered.contains("Test security 12"), "{rendered}");
    assert!(rendered.contains("watchlist-pane"), "{rendered}");
    assert!(rendered.contains("stock-detail-pane"), "{rendered}");
    assert!(rendered.contains(":overflow_y_scrollbar"), "{rendered}");
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
        "+30.00 USD",
        "+80.00 USD",
        "Last / Cost",
        "+4.44%",
        ".font_family[Str(\"monospace\")]",
    ] {
        assert!(rendered.contains(expected), "missing {expected}:\n{rendered}");
    }
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
