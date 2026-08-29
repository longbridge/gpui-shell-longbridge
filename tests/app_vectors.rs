use std::{
    fs,
    ops::Deref as _,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use gpui::{IntoElement as _, TestAppContext, VisualTestContext};
use gpui_shell::ShellRuntime;

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app")
}

fn grant_app_capabilities() {
    let root = app_dir();
    let manifest = gpui_shell::plugin::PluginManifest::read(&root).expect("application manifest");
    gpui_shell::set_capabilities(manifest.capabilities(&root, &std::env::temp_dir()));
}

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct ApplicationFixture {
    root: PathBuf,
}

impl ApplicationFixture {
    fn new(entry: &str) -> Self {
        let ordinal = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "gpui-shell-longbridge-{}-{ordinal}",
            std::process::id()
        ));
        copy_tree(&app_dir(), &root);
        let manifest_path = root.join("gpui-shell.json");
        let manifest = fs::read_to_string(&manifest_path).expect("copied application manifest");
        let manifest = manifest.replacen(
            r#""entry": "main.js""#,
            &format!(r#""entry": "{entry}""#),
            1,
        );
        fs::write(manifest_path, manifest).expect("select test application entry");
        Self { root }
    }
}

impl Drop for ApplicationFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).expect("create application fixture directory");
    for entry in fs::read_dir(source).expect("read application fixture source") {
        let entry = entry.expect("application fixture entry");
        let target = destination.join(entry.file_name());
        if entry
            .file_type()
            .expect("application fixture file type")
            .is_dir()
        {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).expect("copy application fixture file");
        }
    }
}

fn load_test_view(
    runtime: &std::rc::Rc<ShellRuntime>,
    fixture: &ApplicationFixture,
    window: &mut gpui::Window,
    cx: &mut gpui::App,
) -> (
    gpui::Entity<gpui_shell::ShellRoot>,
    gpui::Entity<gpui_shell::ScriptView>,
) {
    let root = runtime
        .try_load(&fixture.root, window, cx)
        .expect("load test application through the public host facade");
    let view = root
        .read(cx)
        .content()
        .clone()
        .downcast::<gpui_shell::ScriptView>()
        .expect("test application content is a script view");
    (root, view)
}

#[gpui::test]
fn omarchy_application_follows_system_appearance(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("main.js");
    let main_path = fixture.root.join("main.js");
    let main = fs::read_to_string(&main_path)
        .expect("copied main.js")
        .replace(
            "this.syncSystemTheme(cx);",
            "this.statusBarVisible = true;\n      this.syncSystemTheme(cx);",
        )
        .replace(
            "let themes = null;",
            r##"let fixtureThemes = [
  'mode = "light"\nbackground = "#eeeeee"\nforeground = "#111111"',
  'mode = "dark"\nbackground = "#111111"\nforeground = "#eeeeee"',
];
function nextFixtureTheme() {
  return fixtureThemes.shift() ?? fixtureThemes[1];
}
let themes = null;"##,
        )
        .replace(
            "const { current_colors } = await import(\"omarchy-theme\");\n    return current_colors();",
            "return nextFixtureTheme();",
        );
    fs::write(main_path, main).expect("install changing appearance fixture");
    let manifest =
        gpui_shell::plugin::PluginManifest::read(&fixture.root).expect("fixture manifest");
    gpui_shell::set_capabilities(manifest.capabilities(&fixture.root, &std::env::temp_dir()));
    gpui_shell::set_storage_path(fixture.root.join("storage.json"));

    let fixture_root = fixture.root.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime
                .try_load(&fixture_root, window, cx)
                .expect("load Omarchy application fixture"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.update(|window, cx| window.draw(cx).clear(cx));
    context.run_until_parked();
    context.update(|_, cx| {
        assert_eq!(
            gpui_base::Theme::global(cx).appearance,
            gpui_base::ThemeAppearance::Light
        );
    });

    context.executor().advance_clock(Duration::from_secs(1));
    context.run_until_parked();
    context.update(|_, cx| {
        assert_eq!(
            gpui_base::Theme::global(cx).appearance,
            gpui_base::ThemeAppearance::Dark,
            "the Omarchy clock must apply a changed system appearance"
        );
    });

    let view = window
        .root(&mut context)
        .expect("Omarchy application root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("Omarchy script view")
        });
    context.update(|window, cx| window.draw(cx).clear(cx));
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    assert!(
        !rendered.contains("theme-toggle"),
        "manual theme controls must not be advertised while following Omarchy:\n{rendered}"
    );
    assert!(
        !rendered.contains("text \"Cmd + T\""),
        "the Omarchy shortcut rail must not advertise manual theme switching:\n{rendered}"
    );
}

#[gpui::test]
fn non_omarchy_application_keeps_manual_theme_switching(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("main.js");
    let main_path = fixture.root.join("main.js");
    let main = fs::read_to_string(&main_path)
        .expect("copied main.js")
        .replace(
            "const fallback = themes[window.appearance()];",
            "const fallback = themes.dark;",
        )
        .replace(
            "this.syncSystemTheme(cx);",
            "this.syncSystemTheme(cx);\n      window.dispatch_action(\"workspace::toggle-theme\");",
        );
    fs::write(main_path, main).expect("install manual theme action fixture");
    let manifest =
        gpui_shell::plugin::PluginManifest::read(&fixture.root).expect("fixture manifest");
    gpui_shell::set_capabilities(manifest.capabilities(&fixture.root, &std::env::temp_dir()));
    gpui_shell::set_storage_path(fixture.root.join("storage.json"));

    let fixture_root = fixture.root.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime
                .try_load(&fixture_root, window, cx)
                .expect("load non-Omarchy application fixture"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.update(|window, cx| window.draw(cx).clear(cx));
    context.run_until_parked();
    context.update(|_, cx| {
        assert_eq!(
            gpui_base::Theme::global(cx).appearance,
            gpui_base::ThemeAppearance::Dark
        );
    });

    context.executor().advance_clock(Duration::from_secs(1));
    context.run_until_parked();
    context.update(|_, cx| {
        assert_eq!(
            gpui_base::Theme::global(cx).appearance,
            gpui_base::ThemeAppearance::Light,
            "non-Omarchy systems must retain the manual theme shortcut"
        );
    });
}

#[gpui::test]
fn quote_stream_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("quote_stream.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));

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
    let fixture = ApplicationFixture::new("auth_http.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));

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
fn fps_visibility_preference_defaults_off_and_round_trips(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let fixture = ApplicationFixture::new("fps_preference.test.js");
    gpui_shell::set_storage_path(fixture.root.join("fps-preference-store.json"));
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));

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
    let fixture = ApplicationFixture::new("chart.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn chart_mode_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("chart_modes.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn candlestick_geometry_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("candlestick_chart.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn chart_mode_state_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("chart_modes_state.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn reconnect_invalidates_the_superseded_chart_request_before_stopping(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("chart_reconnect.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn protocol_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("protocol.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn market_state_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("market.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn market_detail_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("market_detail.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn market_detail_state_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("market_detail_state.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn portfolio_vectors_run_against_this_application(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("portfolio.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let _loaded = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
}

#[gpui::test]
fn watchlist_row_renders_scannable_market_columns(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("watchlist_ui.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
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
        // The column heads, folded to terminal small-caps on their way to the
        // screen. `COLUMN_HINTS` is still keyed by the title as written, which
        // the tooltip assertion further down reads.
        "INSTRUMENT",
        "LAST",
        "CHANGE",
        "VOLUME",
        "SESSION",
        "Apple",
        "text \"AAPL\"",
        "188.00",
        "+4.44%",
        "8.59B",
        "Trading",
        // Field labels beside their values, which stay sentence case.
        "Previous close",
        "Open",
        "Day range",
        "Volume",
        "Session",
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
    // The row opens with an `Avatar` that has only its fallback filled: there
    // is no per-market artwork in the application directory, and an image that
    // never resolves is the case the fallback exists for.
    assert!(
        rendered.contains("Avatar") && rendered.contains("AvatarFallback"),
        "the row must carry a market badge:\n{rendered}"
    );
    assert!(!rendered.contains("AvatarImage"), "{rendered}");
    // The row's figures are monospaced because the whole window is, from the
    // application root down -- which this probe deliberately does not render,
    // so the half it can prove is that nothing here overrides that family.
    // `a_bound_chord_reaches_the_action_that_switches_page` renders the real
    // root and asserts the other half: that exactly one element sets one.
    assert!(
        !rendered.contains(".font_family["),
        "a figure must inherit the root's family, not restate one:\n{rendered}"
    );

    // A TableHead is a semantic table part, not an interactive shell element.
    // Its tooltip must live on the full-size div it contains, otherwise the
    // shell cannot wire the hover listeners and emits a warning instead.
    let instrument_head = rendered
        .lines()
        .find(|line| line.contains(r#"TableHead "watchlist-head-1" #1"#))
        .expect("instrument table header");
    assert!(
        !instrument_head.contains(":tooltip"),
        "the table part cannot own the tooltip: {instrument_head}"
    );
    let instrument_header_children = rendered
        .split_once(r#"TableHead "watchlist-head-1" #1"#)
        .and_then(|(_, following)| following.split_once(r#"TableHead "watchlist-head-2" #2"#))
        .map(|(children, _)| children)
        .expect("instrument header's descendant range");
    let instrument_tooltip = instrument_header_children
        .lines()
        .find(|line| line.contains(r#":tooltip[Str("Ticker and security name")]"#))
        .expect("instrument tooltip on a table-header descendant");
    assert!(
        instrument_tooltip.trim_start().starts_with("div "),
        "a shell-owned div must carry the header tooltip: {instrument_tooltip}"
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
    // Asserted structurally rather than by comparing painted colour: the
    // palette moved out of the Rust host into the application, and a probe is
    // not the application -- it has no filesystem grant to load `theme.json`,
    // so every token here resolves to #000000 and any colour would equal any
    // other. These two are what the bug actually broke.
    assert!(!closed.contains(":selected[Bool(true)]"), "{closed}");
    assert!(open.contains(":selected[Bool(true)]"), "{open}");

    let compact = rendered
        .split_once(r#"Table "probe-watchlist-compact""#)
        .map(|(_, compact)| compact)
        .expect("compact watchlist table");
    for expected in ["INSTRUMENT", "LAST", "AAPL.US", "Apple", "188.00", "+4.44%"] {
        assert!(
            compact.contains(expected),
            "missing compact {expected}:\n{compact}"
        );
    }
    for hidden in ["CHANGE", "VOLUME", "SESSION", "8.59B", "Trading", "Avatar"] {
        assert!(
            !compact.contains(hidden),
            "compact row must hide {hidden}:\n{compact}"
        );
    }
    assert!(
        compact.contains(".truncate") && compact.contains(".min_w[Number(0.0)]"),
        "compact lanes must shrink and truncate rather than overlap:\n{compact}"
    );
    assert!(
        compact.contains(".w[Str(\"60%\")]")
            && compact.contains(".w[Str(\"40%\")]")
            && compact.contains(".h[Number(44.0)]"),
        "the minimum Watchlist layout keeps symbol/name and last/change in two aligned stacked lanes:\n{compact}"
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
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("workspace_ui.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));

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

    assert!(
        rendered.contains("dock_area")
            && rendered.contains(r#":id[Str("workspace-panel-count")]"#)
            && rendered.contains(r#"text "4""#),
        "Dock must contain Watchlist plus three independently movable detail panels: {rendered}"
    );
}

/// The panes still draw what they always drew; they simply draw it inside a
/// panel now. This probe renders one of them directly, which is the only way to
/// read a panel's own description from here.
#[gpui::test]
fn the_watchlist_pane_still_virtualizes_its_rows(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("watchlist_click.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));

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

    // The rows are not in this tree, and that is the point: a virtual list
    // describes itself and its item count, and its rows are built during layout
    // for the range on screen. `watchlist_ui.test.js` covers what one row draws.
    assert!(
        rendered.contains("v_virtual_list \"watchlist-rows\" \u{00d7}12"),
        "{rendered}"
    );
    assert!(
        rendered.contains("Scrollbar \"watchlist-rows\""),
        "{rendered}"
    );
    assert!(!rendered.contains("Test security 12"), "{rendered}");
    assert!(rendered.contains("watchlist-pane"), "{rendered}");
    // Column tooltips remain on shell-owned descendants.
    assert!(rendered.contains(":tooltip"), "{rendered}");
}

#[gpui::test]
fn retained_price_chart_owns_its_indicator_and_dated_tooltip(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("price_chart_view.test.js");
    let fixture_root = fixture.root.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime
                .try_load(&fixture_root, window, cx)
                .expect("load retained price-chart probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.update(|window, cx| window.draw(cx).clear(cx));

    let view = window
        .root(&mut context)
        .expect("price-chart root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("price-chart content is a script view")
        });
    let tree = |context: &mut VisualTestContext| {
        context.update(|_, cx| {
            view.read(cx)
                .snapshot()
                .map(gpui_shell::RenderSnapshot::debug_tree)
                .unwrap_or_default()
        })
    };
    let initial = tree(&mut context);
    assert!(initial.contains("5D intraday"), "{initial}");
    assert!(
        initial.contains("Button \"probe-chart-mode-5D\" .flex_1 :selected[Bool(true)]"),
        "the retained chart starts in its default 5D mode:\n{initial}"
    );
    assert!(initial.contains("price-chart-5D"), "{initial}");
    assert!(initial.contains(":on_mouse_move(fn)"), "{initial}");
    assert!(initial.contains(":on_hover(fn)"), "{initial}");

    context.simulate_mouse_move(
        gpui::point(gpui::px(100.), gpui::px(80.)),
        None,
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let hovered = tree(&mut context);
    assert!(hovered.contains("2026-03-09 09:30"), "{hovered}");
    assert!(!hovered.contains("UTC"), "{hovered}");
    assert!(!hovered.contains("undefined"), "{hovered}");
    assert!(
        hovered.matches("path fill").count() > initial.matches("path fill").count()
            && hovered.matches("path stroke").count() > initial.matches("path stroke").count(),
        "the child must draw its marker and indicator after pointer movement:\n{hovered}"
    );

    // Move out only after the pointer callback replaced the script snapshot.
    // This exercises the current snapshot's genuine `on_hover(false)` path,
    // rather than clearing hover by directly invoking child state.
    context.simulate_mouse_move(
        gpui::point(gpui::px(700.), gpui::px(300.)),
        None,
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let left = tree(&mut context);
    assert!(!left.contains("2026-03-09"), "{left}");
    assert_eq!(
        left.matches("path fill").count(),
        initial.matches("path fill").count(),
        "leaving the replaced child snapshot must remove its marker:\n{left}"
    );
    assert_eq!(
        left.matches("path stroke").count(),
        initial.matches("path stroke").count(),
        "leaving the replaced child snapshot must remove its indicator:\n{left}"
    );

    context.simulate_click(
        gpui::point(gpui::px(400.), gpui::px(14.)),
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    context.simulate_mouse_move(
        gpui::point(gpui::px(100.), gpui::px(100.)),
        None,
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let candles = tree(&mut context);
    assert!(candles.contains("1m candles"), "{candles}");
    assert!(
        candles.contains("O 100  H 104") && candles.contains("Volume 42"),
        "{candles}"
    );
    assert!(candles.contains("price-chart-candles"), "{candles}");
    assert!(
        candles.contains("03-09 09:30") && candles.contains("03-09 09:31"),
        "candlestick charts need market-local date/time references along the bottom axis:\n{candles}"
    );
    assert!(
        candles.contains("2026-03-09 09:30"),
        "candlestick tooltips need a full market-local date and time:\n{candles}"
    );
    assert!(
        candles.contains("candlestick-axis-tick-")
            && candles.contains(r#".left[Number(-40.0)]"#)
            && candles.contains(r#".w[Number(80.0)]"#),
        "candlestick labels must stay centred on their wick without overlapping in a narrow Right Dock:\n{candles}"
    );

    context.simulate_click(
        gpui::point(gpui::px(75.), gpui::px(14.)),
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let intraday = tree(&mut context);
    assert!(intraday.contains("Intraday"), "{intraday}");
    assert!(
        intraday.contains("Overnight")
            && intraday.contains("Pre-market")
            && intraday.contains("Regular")
            && intraday.contains("Post-market"),
        "the full-session line names every provider-labelled session:\n{intraday}"
    );
    assert!(intraday.contains("Previous close 98.5"), "{intraday}");
    assert!(
        intraday.contains("intraday-current-marker"),
        "the current price must remain visible even before the pointer enters the plot:\n{intraday}"
    );
    for (x, session) in [
        (75., "Overnight"),
        (220., "Pre-market"),
        (350., "Regular"),
        (460., "Post-market"),
    ] {
        context.simulate_mouse_move(
            gpui::point(gpui::px(x), gpui::px(100.)),
            None,
            gpui::Modifiers::default(),
        );
        context.run_until_parked();
        context.update(|window, cx| window.draw(cx).clear(cx));
        let tooltip = tree(&mut context);
        assert!(
            tooltip.contains(&format!("Session {session}")),
            "the Intraday tooltip must retain the provider session name {session}:\n{tooltip}"
        );
    }
}

#[gpui::test]
fn retained_price_chart_hover_rebuilds_the_child_without_the_parent(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("price_chart_retained.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_window = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_window
                .try_load(&fixture_root, window, cx)
                .expect("load retained parent/price-chart probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.update(|window, cx| window.draw(cx).clear(cx));

    let parent = window
        .root(&mut context)
        .expect("price-chart parent root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("price-chart parent content is a script view")
        });
    let parent_tree = |context: &mut VisualTestContext| {
        context.update(|_, cx| {
            parent
                .read(cx)
                .snapshot()
                .map(gpui_shell::RenderSnapshot::debug_tree)
                .unwrap_or_default()
        })
    };
    assert!(
        parent_tree(&mut context).contains("Parent renders: 1"),
        "the parent must start with one published snapshot"
    );

    let drive_child_only =
        |context: &mut VisualTestContext, point: gpui::Point<gpui::Pixels>, operation: &str| {
            let before = runtime.read_metrics();
            context.simulate_click(point, gpui::Modifiers::default());
            context.run_until_parked();
            context.update(|window, cx| window.draw(cx).clear(cx));
            assert_eq!(
                runtime.read_metrics().since(&before).script_renders(),
                1,
                "{operation} must rebuild exactly the retained child"
            );
            let tree = parent_tree(context);
            assert!(
                tree.contains("Parent renders: 1"),
                "{operation} rebuilt the parent:\n{tree}"
            );
        };

    drive_child_only(
        &mut context,
        gpui::point(gpui::px(75.), gpui::px(20.)),
        "loading props",
    );
    drive_child_only(
        &mut context,
        gpui::point(gpui::px(225.), gpui::px(20.)),
        "error props",
    );
    drive_child_only(
        &mut context,
        gpui::point(gpui::px(375.), gpui::px(20.)),
        "ready props",
    );

    let before_hover = runtime.read_metrics();
    context.simulate_mouse_move(
        gpui::point(gpui::px(100.), gpui::px(100.)),
        None,
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    assert_eq!(
        runtime.read_metrics().since(&before_hover).script_renders(),
        1,
        "hover must rebuild exactly the retained chart child"
    );
    let tree = parent_tree(&mut context);
    assert!(
        tree.contains("Parent renders: 1"),
        "hover rebuilt the parent:\n{tree}"
    );
}

#[gpui::test]
fn a_large_candlestick_publication_does_not_overflow_nested_view_rollback(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("price_chart_large.test.js");
    let fixture_root = fixture.root.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime
                .try_load(&fixture_root, window, cx)
                .expect("load large price-chart probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    context.simulate_click(
        gpui::point(gpui::px(160.), gpui::px(20.)),
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let root = window.root(&mut context).expect("large-chart root");
    let rendered = root.read_with(&context, |root, cx| {
        root.0
            .read(cx)
            .content()
            .clone()
            .downcast::<gpui_shell::ScriptView>()
            .expect("large-chart script view")
            .read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    assert!(
        rendered.contains("Publish 12,000 candles · published")
            && !rendered.contains("rollback limit"),
        "publishing a full minute window must not cross the nested-view rollback limit:\n{rendered}"
    );
}

#[gpui::test]
fn unrelated_quote_updates_do_not_rebuild_the_price_chart_child(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("price_chart_updates.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_window = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_window
                .try_load(&fixture_root, window, cx)
                .expect("load price-chart update probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.update(|window, cx| window.draw(cx).clear(cx));
    let before = runtime.read_metrics();

    context.simulate_click(
        gpui::point(gpui::px(20.), gpui::px(20.)),
        gpui::Modifiers::default(),
    );
    // Quotes no longer repaint as they land. They arrive in bursts and a
    // repaint on a restored layout is a whole-window refresh, so the burst is
    // coalesced into one; the clock this advances past is that coalescing
    // window, not a delay anybody waits on.
    context.executor().advance_clock(Duration::from_millis(200));
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let delta = runtime.read_metrics().since(&before);

    assert_eq!(
        delta.script_renders(),
        1,
        "the unrelated quote should rebuild only the root, not its chart child"
    );
}

#[gpui::test]
fn clicking_a_watchlist_row_selects_that_instruments_details(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("watchlist_click.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_view = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_view
                .try_load(&fixture_root, window, cx)
                .expect("load authenticated watchlist click probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.update(|window, cx| window.draw(cx).clear(cx));

    // The table header occupies the first 44px after the Watchlist's title
    // bar. The second uniform 44px item is therefore at y=130 in this fixed
    // probe layout. Clicking it exercises the native virtual-list hit box,
    // rather than invoking selection directly.
    context.simulate_click(
        gpui::point(gpui::px(200.), gpui::px(130.)),
        gpui::Modifiers::default(),
    );
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));

    let view = window
        .root(&mut context)
        .expect("workspace root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("workspace content is a script view")
        });
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    assert!(
        rendered.contains("Selected TEST01.US"),
        "clicking the second visible row must select its stock details:\n{rendered}"
    );
}

#[gpui::test]
fn allocation_donut_folds_past_the_available_theme_palette(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("allocation_ui.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
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

    // Color origin is covered by palette.test.js; this host-level vector owns
    // chart geometry and folding, not a particular installed Omarchy theme.
}

#[gpui::test]
fn portfolio_renders_pnl_summary_and_position_columns(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("portfolio_ui.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
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
        // The ring's own heading and the Holdings column head, both drawn as
        // terminal small-caps.
        "ALLOCATION",
        "Apple",
        "100.0%",
        "+30.00 USD",
        "+80.00 USD",
        "LAST / COST",
    ] {
        assert!(
            rendered.contains(expected),
            "missing {expected}:\n{rendered}"
        );
    }
    // Portfolio figures are monospaced because the window is, set once at the
    // application root -- which this probe renders the page without. So what
    // it proves is that no figure here overrides that family; the root's own
    // half is asserted in `a_bound_chord_reaches_the_action_that_switches_page`.
    assert!(
        !rendered.contains(".font_family["),
        "a figure must inherit the root's family, not restate one:\n{rendered}"
    );
    assert!(rendered.contains("Table \"allocation-USD\""), "{rendered}");
    assert!(rendered.contains("path fill"), "{rendered}");

    // The page itself does not scroll. Holdings takes the leftover height and
    // scrolls inside its own virtualized list, so the window never grows a
    // scrollbar around the whole column -- and a page that scrolled would put a
    // second scroll outside the table's, which is how Holdings used to end up
    // unreachable.
    assert_eq!(
        rendered.matches(":overflow_y_scroll[]").count(),
        0,
        "the portfolio page must not scroll as a whole:\n{rendered}"
    );
    assert!(
        !rendered.contains(":overflow_y_scrollbar"),
        "no panel scrolls inside the page scroll:\n{rendered}"
    );
    // The explanatory Popover beside the chart, distinct from the Watchlist menu.
    assert!(
        rendered.contains("Popover \"allocation-help\""),
        "{rendered}"
    );
    assert!(rendered.contains("allocation-help-trigger"), "{rendered}");

    // Holdings virtualizes too, so its rows are built during layout and are not
    // in this tree — `watchlist_ui.test.js` covers what one row draws. What is
    // here is the table around them, announcing a size the body never renders.
    assert!(
        rendered.contains("Table \"holdings-table\"")
            && rendered.contains(":row_count[Number(2.0)]"),
        "holdings must be a table that announces its full size:\n{rendered}"
    );
    assert!(
        rendered.contains("v_virtual_list \"holdings-rows\" \u{00d7}1"),
        "{rendered}"
    );
    assert!(!rendered.contains("+4.44%"), "{rendered}");

    // And a filter for it.
    assert!(rendered.contains("Input"), "{rendered}");
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

struct WorkspaceRoot(gpui::Entity<gpui_shell::ShellRoot>);

impl gpui::Render for WorkspaceRoot {
    fn render(
        &mut self,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        self.0.clone().into_any_element()
    }
}

#[gpui::test]
fn stock_details_keep_the_chart_visible_beside_collapsible_metadata(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("detail_ui.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(520.), gpui::px(760.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    // Each reading is its own dock-ready panel. Quote is always expanded; its
    // tile replaces the old disclosure and the redundant subtitle is gone.
    assert!(
        rendered.contains("quote-details-panel")
            && rendered.contains("chart-panel")
            && rendered.contains("market-detail-panel"),
        "{rendered}"
    );
    assert!(
        !rendered.contains("detail-quote-trigger") && !rendered.contains("Real-time quote"),
        "Quote Details must be permanently expanded without duplicated copy:\n{rendered}"
    );
    assert!(
        rendered.contains("AccordionTrigger \"detail-about-trigger\" :on_change(fn)"),
        "{rendered}"
    );

    // The chart is permanent content, not a disclosure with a title row.
    assert!(!rendered.contains("detail-chart-trigger"), "{rendered}");
    assert!(!rendered.contains("text \"Price chart\""), "{rendered}");
    assert!(rendered.contains("price-chart-wheel"), "{rendered}");
    assert!(
        rendered.contains("chart-mode-selector")
            && rendered.contains("Button \"chart-mode-intraday\"")
            && rendered.contains("Button \"chart-mode-5D\""),
        "the chart selector stays present above every chart state:\n{rendered}"
    );
    assert!(
        rendered.contains("chart-mode-selector") && rendered.contains(":overflow_x_scroll"),
        "a narrow detail pane scrolls the one-row selector instead of wrapping it:\n{rendered}"
    );
    assert!(
        rendered.contains("AccordionPanel :keep_mounted[Bool(false)]"),
        "{rendered}"
    );

    // About remains optional inside Quote Details.
    assert!(
        rendered.contains("text \"About this instrument\""),
        "{rendered}"
    );
    assert!(
        rendered.contains("AccordionItem :open[Bool(false)]"),
        "the shut section must carry its state on the item:\n{rendered}"
    );

    // The month grid, read off the retained CalendarState. August 2026 opens
    // on a Saturday, so its first week is six days of July and the 1st.
    assert!(
        rendered.contains("Button \"calendar-day-2026-07-26\"")
            && rendered.contains("Button \"calendar-day-2026-08-01\""),
        "the grid must carry the neighbouring month's days:\n{rendered}"
    );
    assert!(
        rendered.contains("Button \"calendar-day-2026-08-14\" :selected[Bool(true)]"),
        "the chosen day must be the selected cell:\n{rendered}"
    );

    // The surface is the script's own, so it closes on a press outside; and
    // the wheel over the chart drives a value rather than a scroll container.
    assert!(rendered.contains(":on_mouse_down_out(fn)"), "{rendered}");
    assert!(
        rendered.contains("div :id[Str(\"price-chart-wheel\")] :on_scroll_wheel(fn)"),
        "{rendered}"
    );

    // The retained chart child is still a child, and still not rebuilt here.
    assert!(rendered.contains("child_view #"), "{rendered}");

    // Market Detail owns the one tape/order-book scroll and follows Chart.
    // These assertions are intentionally written before the panel exists: the
    // fixture contains two levels and 21 trades, so a correct UI must reverse
    // asks, retain the best prices beside the ratio, and cap the rendered
    // tape at 20 rows.
    assert!(rendered.contains("Order Book"), "{rendered}");
    assert!(rendered.contains("Time & Sales"), "{rendered}");
    assert!(
        rendered.find("Order Book") > rendered.find("child_view #"),
        "{rendered}"
    );
    assert!(
        rendered.find("Time & Sales") > rendered.find("Order Book"),
        "{rendered}"
    );
    assert!(
        rendered.contains("188.20") && rendered.contains("188.10"),
        "{rendered}"
    );
    assert!(
        rendered.contains("Bid 59%") && rendered.contains("Ask 41%"),
        "{rendered}"
    );
    assert!(
        rendered.contains("↑") && rendered.contains("↓") && rendered.contains("•"),
        "{rendered}"
    );
    let first_trade = rendered
        .split_once(r#"time-sales-row-1700000000|188.00|100|T|0|0"#)
        .map(|(_, row)| row)
        .expect("first time-and-sales row");
    assert!(
        first_trade.contains("• Neutral"),
        "Longbridge direction 0 must be neutral:\n{first_trade}"
    );
    let down_trade = rendered
        .split_once(r#"time-sales-row-1699999999|188.01|200|T|1|0"#)
        .map(|(_, row)| row)
        .expect("down time-and-sales row");
    assert!(
        down_trade.contains("↓ Down"),
        "Longbridge direction 1 must be down:\n{down_trade}"
    );
    let up_trade = rendered
        .split_once(r#"time-sales-row-1699999998|188.02|300|T|2|0"#)
        .map(|(_, row)| row)
        .expect("up time-and-sales row");
    assert!(
        up_trade.contains("↑ Up"),
        "Longbridge direction 2 must be up:\n{up_trade}"
    );
    for trade in [first_trade, down_trade, up_trade] {
        assert!(
            trade.contains(".bg[") && trade.contains(".opacity[Number("),
            "each textual direction must also have a semantic, intensity-scaled volume marker:\n{trade}"
        );
    }
    assert!(
        rendered.contains("17:13:20"),
        "Time & Sales must show selected market-local time, not UTC/browser local time:\n{rendered}"
    );
    assert_eq!(
        rendered.matches("time-sales-row-").count(),
        20,
        "{rendered}"
    );
    assert_eq!(
        rendered.matches(":overflow_y_scrollbar").count(),
        3,
        "{rendered}"
    );
    assert!(
        rendered.contains("order-book-ask-level-1")
            && rendered.contains("order-book-bid-level-1")
            && rendered.contains("time-sales-row-")
            && rendered.contains(".truncate"),
        "market-detail rows keep domain identities and shrink instead of overlapping:\n{rendered}"
    );
    assert!(
        !rendered.contains("order-book-ask-slot") && !rendered.contains("order-book-bid-slot"),
        "missing depth must not reserve placeholder rows:\n{rendered}"
    );
    let order_book = rendered
        .split_once(r#":id[Str("order-book-panel")]"#)
        .and_then(|(_, section)| {
            section
                .split_once(r#":id[Str("time-sales-panel")]"#)
                .map(|(section, _)| section)
        })
        .expect("order-book section");
    assert!(
        !order_book.contains(".border[") && !order_book.contains(".rounded["),
        "detail sections must use hairlines inside the one detail panel, not nested cards:\n{order_book}"
    );
}

#[gpui::test]
fn market_detail_panels_name_loading_empty_and_error_states(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("detail_ui_states.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(360.), gpui::px(480.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });
    for expected in [
        "Loading live market data…",
        "Depth entitlement unavailable",
        "No recent trades",
        "Trade feed unavailable",
        "Loading",
        "Empty",
        "Error",
        "2 trades",
    ] {
        assert!(
            rendered.contains(expected),
            "missing {expected}:\n{rendered}"
        );
    }
    assert!(
        !rendered.contains("No order book data")
            && !rendered.contains("order-book-ask-level-1")
            && !rendered.contains("order-book-bid-level-1"),
        "a ready book without valid price/volume levels should collapse instead of drawing fake rows or explanatory filler:\n{rendered}"
    );
}

#[gpui::test]
fn sparse_order_book_keeps_best_levels_next_to_the_spread(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("detail_ui_sparse.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(360.), gpui::px(300.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    assert!(rendered.contains("order-book-ask-level-1"), "{rendered}");
    assert!(rendered.contains("order-book-bid-level-1"), "{rendered}");
    assert!(!rendered.contains("order-book-ask-slot"), "{rendered}");
    for row in ["order-book-ask-level-1", "order-book-bid-level-1"] {
        let row = rendered
            .split_once(row)
            .map(|(_, row)| row.split("h_flex :id").next().unwrap_or(row))
            .expect("depth row");
        for lane in [r#".w[Str("28%")]"#, r#".w[Str("36%")]"#] {
            assert!(
                row.contains(lane),
                "Ask and Bid must share the same level/price/volume lanes:\n{row}"
            );
        }
        assert!(row.contains(r#".h[Number(22.0)]"#), "{row}");
    }
    let divider = rendered
        .split_once(r#"order-book-ratio-divider"#)
        .and_then(|(_, divider)| {
            divider
                .split_once("order-book-bid-level-1")
                .map(|(divider, _)| divider)
        })
        .expect("single ratio divider");
    assert!(
        divider.contains(r#".h[Number(22.0)]"#)
            && divider.matches(r#".w[Str("28%")]"#).count() == 2
            && divider.contains("Bid 46%")
            && divider.contains("Ask 54%"),
        "ratio labels and bar must share one symmetric compact row:\n{divider}"
    );
    assert!(
        rendered.find("140.30") < rendered.find("Bid 46%")
            && rendered.find("Bid 46%") < rendered.find("140.20"),
        "Ask 1 must hug the divider above and Bid 1 below it:\n{rendered}"
    );
}

#[gpui::test]
fn holdings_scroll_as_one_virtualized_collection_without_pagination(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("holdings_pager.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(900.), gpui::px(900.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    assert!(!rendered.contains("Pagination"), "{rendered}");
    assert!(
        rendered.contains("v_virtual_list \"holdings-rows\" \u{00d7}80"),
        "the table must own all holdings in one virtualized collection:\n{rendered}"
    );
}

#[gpui::test]
fn a_bound_chord_reaches_the_action_that_switches_page(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("keymap_ui.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_view = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_view
                .try_load(&fixture_root, window, cx)
                .expect("load keymap probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));

    let view = window
        .root(&mut context)
        .expect("workspace root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("workspace content is a script view")
        });
    let tree = |context: &mut VisualTestContext| {
        context.update(|_, cx| {
            view.read(cx)
                .snapshot()
                .map(gpui_shell::RenderSnapshot::debug_tree)
                .unwrap_or_default()
        })
    };

    let before = tree(&mut context);
    assert!(
        before.contains("div :id[Str(\"workspace-root\")] :key_context[Str(\"Workspace\")]"),
        "the root must declare the context the keymap is written against:\n{before}"
    );

    assert!(
        !before.contains(".font_family["),
        "the application must inherit the platform font without an override:\n{before}"
    );

    context.simulate_keystrokes("ctrl-2");
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let after = tree(&mut context);
    assert!(
        after.contains("workspace-page"),
        "ctrl-2 must reach `workspace::portfolio`:\n{after}"
    );
    // A chord the keymap claims becomes an action and is not also delivered as
    // a key press, so the footer's readout stays empty for it. An unbound one
    // reaches `on_key_down`, and arrives already unparsed as the whole chord —
    // spelled `cmd` on every platform, this one included.
    assert!(!after.contains("text \"ctrl-2\""), "{after}");
    context.simulate_keystrokes("ctrl-alt-y");
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let typed = tree(&mut context);
    // The chord still arrives as the whole unparsed `ctrl-alt-y`; what changed
    // is how it is *written* for a reader. Modifiers in a fixed order, a space
    // either side of every `+`, one name per key — the same grammar the footer's
    // shortcut rail uses, because a chord that just happened and a chord that is
    // available are the same kind of thing said in the same kind of cap.
    assert!(
        typed.contains("text \"Ctrl + Alt + Y\""),
        "an unbound chord must reach on_key_down:\n{typed}"
    );

    context.simulate_keystrokes("ctrl-1");
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let back = tree(&mut context);
    assert!(
        back.contains("watchlist-pane"),
        "ctrl-1 must reach `workspace::watchlist`:\n{back}"
    );
}

#[gpui::test]
fn the_window_readout_follows_the_window_it_is_measuring(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("keymap_ui.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_view = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_view
                .try_load(&fixture_root, window, cx)
                .expect("load keymap probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.run_until_parked();

    let view = window
        .root(&mut context)
        .expect("workspace root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("workspace content is a script view")
        });
    // A resize is not an invalidation — a script view renders when it is
    // notified, and the runtime reports no resize event — so each measurement
    // is taken on the first render after one. An unbound chord is the cheapest
    // notification there is: it reaches `on_key_down` and nothing else.
    let redraw = |context: &mut VisualTestContext, width: f32, chord: &str| {
        context.simulate_resize(gpui::size(gpui::px(width), gpui::px(800.)));
        context.run_until_parked();
        context.simulate_keystrokes(chord);
        context.run_until_parked();
        context.update(|window, cx| window.draw(cx).clear(cx));
        context.update(|_, cx| {
            view.read(cx)
                .snapshot()
                .map(gpui_shell::RenderSnapshot::debug_tree)
                .unwrap_or_default()
        })
    };

    // Where the panes sit is the dock's business now, and the user's. What is
    // still this view's is the readout: it measures the window on every render,
    // and a resize is not an invalidation, so the value has to follow the
    // notification rather than the resize.
    let wide = redraw(&mut context, 1400., "ctrl-alt-y");
    assert!(wide.contains("1400\u{d7}800"), "{wide}");
    assert!(!wide.contains("narrow"), "{wide}");

    let narrow = redraw(&mut context, 700., "ctrl-alt-u");
    assert!(
        narrow
            .contains("700\u{d7}800 \u{b7} 16px/rem \u{b7} light \u{b7} background \u{b7} narrow"),
        "the readout must follow the window:\n{narrow}"
    );
}

#[gpui::test]
fn escape_puts_away_what_the_workspace_opened_and_then_carries_on(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("keymap_ui.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_view = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_view
                .try_load(&fixture_root, window, cx)
                .expect("load keymap probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));

    let view = window
        .root(&mut context)
        .expect("workspace root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("workspace content is a script view")
        });
    let tree = |context: &mut VisualTestContext| {
        context.update(|_, cx| {
            view.read(cx)
                .snapshot()
                .map(gpui_shell::RenderSnapshot::debug_tree)
                .unwrap_or_default()
        })
    };

    let opened = tree(&mut context);
    assert!(opened.contains("chart-calendar-surface"), "{opened}");
    // Every avatar in the application is a fallback: it knows no faces, and
    // the product mark is already in the header rather than in a circle.
    // `avatar_slots.test.js` is where the image slot is checked.
    assert!(opened.contains("AvatarFallback"), "{opened}");
    assert!(!opened.contains("AvatarImage"), "{opened}");

    context.simulate_keystrokes("escape");
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let dismissed = tree(&mut context);
    assert!(
        !dismissed.contains("chart-calendar-surface"),
        "escape must put the picker away:\n{dismissed}"
    );

    // With nothing left to dismiss the workspace hands the action back with
    // `cx.propagate()`, so a second press is a no-op rather than an error.
    context.simulate_keystrokes("escape");
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let again = tree(&mut context);
    assert!(again.contains("workspace-root"), "{again}");
    assert!(!again.contains("chart-calendar-surface"), "{again}");
}

#[gpui::test]
fn a_right_press_in_the_watchlist_copies_the_selected_instrument(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("keymap_ui.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_view = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_view
                .try_load(&fixture_root, window, cx)
                .expect("load keymap probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));

    // A press, not a click: `on_click` reports neither which button nor how
    // many presses ago, and a watchlist row cannot carry a handler of its own
    // because the virtual list rebuilds its rows every frame it scrolls.
    context.simulate_event(gpui::MouseDownEvent {
        button: gpui::MouseButton::Right,
        position: gpui::point(gpui::px(200.), gpui::px(200.)),
        modifiers: gpui::Modifiers::default(),
        click_count: 1,
        first_mouse: false,
    });
    context.run_until_parked();

    let copied = context.update(|_, cx| cx.read_from_clipboard());
    assert_eq!(
        copied.and_then(|item| item.text()),
        Some("AAPL.US".to_owned()),
        "a right press over the Watchlist must copy the selected instrument"
    );
}

#[gpui::test]
fn the_diagnostics_popover_answers_every_window_measurement(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("keymap_ui.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
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

    // Every read the window answers, taken as the popover draws -- all of them
    // legal from `render`, which is the half of the window API a script can
    // reach from there.
    for reading in [
        "Viewport",
        "Bounds",
        "Rem size",
        "Line height",
        "Pointer",
        "Appearance",
        "Active",
        "State",
    ] {
        assert!(
            rendered.contains(&format!("text \"{reading}\"")),
            "missing window reading {reading}:\n{rendered}"
        );
    }
    assert!(rendered.contains("text \"1920\u{d7}1080\""), "{rendered}");
    assert!(rendered.contains("text \"16px\""), "{rendered}");
    assert!(rendered.contains("text \"normal\""), "{rendered}");

    // And every change, on a button rather than in the pass that draws --
    // which is the other half, and refused from `render`.
    // The rem-size commands are the type scale's body, title and heading steps
    // now; 18 was not on it, and a control offering a size the interface never
    // draws in is offering one nothing was measured against.
    for command in [
        "shell-rem-12",
        "shell-rem-14",
        "shell-rem-16",
        "shell-focus-next",
        "shell-focus-prev",
        "shell-activate",
        "shell-refresh",
    ] {
        assert!(
            rendered.contains(&format!("Button \"{command}\"")),
            "missing window command {command}:\n{rendered}"
        );
    }
}

#[gpui::test]
fn a_dispatched_action_reaches_the_handler_a_chord_would(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("keymap_ui.test.js");
    let fixture_root = fixture.root.clone();
    let runtime_for_view = runtime.clone();
    let window = cx.add_window(move |window, cx| {
        WorkspaceRoot(
            runtime_for_view
                .try_load(&fixture_root, window, cx)
                .expect("load keymap probe"),
        )
    });
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));

    let view = window
        .root(&mut context)
        .expect("workspace root")
        .read_with(&context, |root, cx| {
            root.0
                .read(cx)
                .content()
                .clone()
                .downcast::<gpui_shell::ScriptView>()
                .expect("workspace content is a script view")
        });
    let tree = |context: &mut VisualTestContext| {
        context.update(|_, cx| {
            view.read(cx)
                .snapshot()
                .map(gpui_shell::RenderSnapshot::debug_tree)
                .unwrap_or_default()
        })
    };

    let before = tree(&mut context);
    assert!(!before.contains("Restoring session"), "{before}");

    // The chord is bound to nothing. What carries it is the probe calling
    // `window.dispatch_action`, the way the session menu's Reconnect item does.
    context.simulate_keystrokes("ctrl-alt-d");
    context.run_until_parked();
    context.update(|window, cx| window.draw(cx).clear(cx));
    let after = tree(&mut context);
    assert!(
        after.contains("Restoring session"),
        "a dispatched action must reach the same handler a chord would:\n{after}"
    );
}

#[gpui::test]
fn an_avatar_draws_its_image_when_it_has_one_and_its_fallback_otherwise(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("avatar_slots.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(200.), gpui::px(100.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    // The slot is chosen by the avatar, so both are described and only the
    // image is drawn where there is one.
    assert!(
        rendered.contains("AvatarImage \"assets/logo-light.svg\""),
        "the image slot must carry the application-relative path:\n{rendered}"
    );
    assert!(rendered.contains("AvatarFallback"), "{rendered}");
    assert!(
        rendered.contains("text \"LB\"") && rendered.contains("text \"US\""),
        "{rendered}"
    );
}

#[gpui::test]
fn title_bar_draws_the_themed_official_svg_mark(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    grant_app_capabilities();
    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let fixture = ApplicationFixture::new("title_bar_ui.test.js");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let (_root, view) = context.update(|window, cx| load_test_view(&runtime, &fixture, window, cx));
    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(640.), gpui::px(48.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    assert!(
        [
            ("assets/logo-foreground.svg", "#f4f7ff"),
            ("assets/logo-info-cyan.svg", "#20d9ff"),
            ("assets/logo-warning.svg", "#f5c76d"),
            ("assets/logo-danger.svg", "#ff758f"),
        ]
        .iter()
        .all(|(asset, color)| {
            rendered.contains(&format!(
                "svg \"{asset}\" .absolute .inset_0 .text_color[Str(\"{color}\")]"
            ))
        }) && !rendered.contains(".absolute .left[Number(1.0)]"),
        "the title bar must layer the semantic official SVG marks rather than reconstructing bars:\n{rendered}"
    );
}
