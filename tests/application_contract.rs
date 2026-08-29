use std::{fs, path::PathBuf};

fn app_dir() -> PathBuf {
    std::env::var_os("LONGBRIDGE_CONTRACT_APP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app"))
}

#[test]
fn application_uses_the_system_font_instead_of_bundling_one() {
    let root = app_dir();
    let host = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("main.rs"),
    )
    .expect("host main.rs");
    let script = fs::read_to_string(root.join("main.js")).expect("application main.js");

    assert!(
        !root.join("assets/fonts").exists(),
        "font assets must not ship with the app"
    );
    assert!(
        !host.contains("include_bytes!") && !host.contains("add_fonts("),
        "the host must not embed or register an application font"
    );
    assert!(
        !script.contains(".font_family("),
        "the application must inherit the system font"
    );
}

#[test]
fn manifest_grants_longbridge_network_access() {
    let root = app_dir();
    let manifest = gpui_shell::plugin::PluginManifest::read(&root).expect("plugin manifest");
    let capabilities = manifest.capabilities(&root, &std::env::temp_dir());

    assert!(capabilities.may_reach("openapi.longbridge.com"));
    assert!(capabilities.may_reach("openapi-quote.longbridge.com"));
    assert!(capabilities.may_request("https", "openapi.longbridge.com", None, "POST", "/any/path"));
    assert!(!capabilities.may_run("longbridge"));
    assert!(
        !fs::read_to_string(root.join("gpui-shell.json"))
            .expect("manifest source")
            .contains("/etc"),
        "Omarchy colors replace the old operating-system identity probe"
    );
}

#[test]
fn host_reads_only_the_materialized_omarchy_palette() {
    let host = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("main.rs"),
    )
    .expect("host main.rs");
    assert!(host.contains(".local/state/omarchy/current/theme/colors.toml"));
    assert!(host.contains("HostModule::new(\"omarchy-theme\")"));
    assert!(
        host.contains("gpui-shell/plugins"),
        "existing login storage must remain stable"
    );
}

#[test]
fn debug_builds_watch_application_sources() {
    let host = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("main.rs"),
    )
    .expect("host main.rs");
    assert!(host.contains("#[cfg(debug_assertions)]"));
    assert!(host.contains("runtime.watch(&root, window, cx)"));
    assert!(host.contains("watcher.forget()"));
}

#[test]
fn the_only_change_this_application_makes_is_to_the_watchlist() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");
    let market = fs::read_to_string(app_dir().join("market.js")).expect("market.js");
    let orders = fs::read_to_string(app_dir().join("orders.js")).expect("orders.js");
    let http = fs::read_to_string(app_dir().join("http.js")).expect("http.js");

    assert!(
        main.contains("/v1/watchlist/groups"),
        "watchlist must load from the API"
    );
    assert!(
        main.contains("/v1/trade/order/today") && main.contains("/v1/trade/order/history"),
        "the Orders page must read both order lists from the read-only API"
    );
    assert!(
        market.contains("sortLikeTerminal"),
        "watchlist must use terminal-compatible sorting"
    );
    // Each Dock tile names its own reading because a one-tab group hides its
    // tab strip. The names must remain stable across layout restoration.
    for expected in [
        "Watchlist",
        "Quote Details",
        "Chart",
        "Market Detail",
        "Portfolio",
        "Holdings",
        "Orders",
        "Today Orders",
        "History Orders",
    ] {
        assert!(
            main.contains(expected) || ui.contains(expected),
            "missing view copy {expected}"
        );
    }
    assert!(
        main.contains("priceChart") && main.contains("allocationChart"),
        "read-only market and allocation charts must remain wired"
    );
    // The application changes exactly one thing about an account: which
    // securities it watches. That is one path, one method, and the HTTP
    // boundary is where it is enforced rather than remembered -- a second
    // writable path would have to be added here before it could be added
    // there.
    assert!(
        http.contains(r#"const EDITABLE_PATHS = new Set(["/v1/watchlist/groups"]);"#)
            && http.contains("assertEditablePath(path);")
            && http.matches(r#"method: "#).count() == 1
            && http.contains(r#"method: "PUT","#),
        "the only write this boundary can make is to the watchlist's own groups"
    );
    // Everything else stays a reading. An order is something an account
    // already placed; nothing here submits, amends or withdraws one.
    for forbidden in [
        "Place order",
        "Cancel order",
        "/v1/trade/order/submit",
        "/v1/trade/order/replace",
        "/v1/trade/order/withdraw",
    ] {
        assert!(
            !main.contains(forbidden)
                && !ui.contains(forbidden)
                && !market.contains(forbidden)
                && !orders.contains(forbidden),
            "forbidden trading surface {forbidden}"
        );
    }
    // The two side captions exist in exactly one place, `orders.js`, and only
    // as the reading of an order the account already placed. Nothing that
    // draws a control may name them: a caption in `ui.js` or `main.js` would
    // be a button that trades, which this application does not have.
    for forbidden in ["Buy", "Sell"] {
        assert!(
            !main.contains(&format!("\"{forbidden}\""))
                && !ui.contains(&format!("\"{forbidden}\""))
                && !market.contains(&format!("\"{forbidden}\"")),
            "forbidden trading control label {forbidden}"
        );
    }
    assert!(
        !orders.contains("fetch(") && !orders.contains("POST"),
        "the order reader normalizes an answer and never sends one"
    );
    for forbidden in [
        "trade::buy",
        "trade::sell",
        "trade::place-order",
        "trade::cancel-order",
    ] {
        assert!(
            !main.contains(forbidden)
                && !ui.contains(forbidden)
                && !market.contains(forbidden)
                && !orders.contains(forbidden),
            "forbidden trading action {forbidden}"
        );
    }
    // Retained text state is the four list filters, which narrow what is
    // already on screen, and the one field that names a security to add.
    // Nothing composes an order.
    assert!(
        main.matches("InputState.new({ placeholder:").count() == 5
            && main.contains("Filter watchlist")
            && main.contains("Filter holdings")
            && main.matches("Filter orders").count() == 2
            && main.contains(r#"placeholder: "AAPL.US""#),
        "the only retained text state may be the list filters and the symbol to add"
    );
    assert!(
        market.contains("export function filterRows"),
        "filtering must stay a pure function outside the render path"
    );

    // Both lists are real tables: `row_count` describes the whole collection so
    // a window onto it still announces its size.
    assert!(
        main.contains("Table.new(`${id}-table`)") && main.contains(".row_count(rows.length + 1)"),
        "both lists must be virtualized tables that announce their full size"
    );
    assert!(
        ui.contains("TableHead.new(")
            && ui.contains("TableCell.new(")
            && ui.contains("TableRow.new("),
        "rows and headers must be table parts rather than styled flex containers"
    );
    assert!(main.contains("const tokens = cx.theme()"));
    assert!(!main.contains(".text_color(\"") && !ui.contains(".text_color(\""));
    assert!(!main.contains("rgb(") && !ui.contains("rgb("));
    // Each page owns its scrolling now, and each does it the way its content
    // needs. Neither scrolls as a page: both put the scroll inside the table
    // that has more rows than room, which is the virtualized one, so the window
    // never grows a bar around a whole column and no page nests one scroll
    // inside another. Neither paints a window bar either.
    assert!(
        !main.contains(".overflow_y_scroll()"),
        "no page may scroll as a whole; the table inside it does"
    );
    // Both lists go through one virtualized table, so the list and the bar are
    // named from the same id and cannot drift apart.
    assert!(
        main.contains("v_virtual_list(")
            && main.contains("`${id}-rows`,")
            && main.contains("Scrollbar.vertical(`${id}-rows`)"),
        "both lists must virtualize their rows and pair a scrollbar with them by name"
    );
    assert!(
        main.contains(".id(\"watchlist-panels\")")
            && main.contains("workspacePanel(tokens, \"Watchlist\"")
            && main.contains("workspacePanel(tokens, \"Quote Details\"")
            && main.contains("const chart = workspacePanel(")
            && main.contains("      \"Chart\",")
            && main.contains("workspacePanel(tokens, \"Market Detail\"")
            && !main.contains("DockArea")
            && !main.contains("dock_area("),
        "Watchlist and detail readings must be four plain responsive Panels without Dock state"
    );

    // A row inside a virtual list cannot register a handler: it is rebuilt on
    // every scrolled frame, so selection belongs to the list.
    assert!(
        main.contains(".on_item_click(") && !ui.contains(".on_click(onSelect)"),
        "watchlist selection must come from the list's on_item_click"
    );

    // Both bound anchored surfaces are exercised, and the pointer affordances
    // with them.
    assert!(
        main.contains("Popover.new(\"user-menu\")")
            && main.contains("Popover.new(\"allocation-help\")"),
        "both Popover scenarios must stay wired"
    );
    assert!(
        ui.contains(".role(\"menu_item\")") && ui.contains(".role(\"menu\")"),
        "the popup menu must announce itself as a menu"
    );
    assert!(ui.contains(".tooltip("), "pointer hints must stay wired");

    // Authorization opens the page itself. The address is only known once the
    // device code exists, and it is not one anyone reads.
    assert!(
        main.contains("open_url(authorization.verificationUri)")
            && main.contains("cx.open_url(\"https://longbridge.com\")")
            && main.contains("cx.open_url(\"https://github.com/longbridge/longbridge-lite\")")
            && main.contains("\"user-menu-sign-out\"")
            && main.contains("\"Sign out\"")
            && !main.contains("user-menu-switch-account")
            && main.contains("Button.new(\"longbridge-home-link\")")
            && !main.contains("device.verificationUri,\n              device.verificationUri,"),
        "sign-in must open the authorization page rather than print its URL"
    );
}

#[test]
fn price_chart_is_a_retained_child_view() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let chart =
        fs::read_to_string(app_dir().join("price_chart_view.js")).expect("price_chart_view.js");

    assert!(
        main.contains("cx.new(PriceChartView")
            && main.contains(".child(this.priceChart)")
            && main.contains("this.priceChart.set_props(")
            && main.contains("this.priceChart.release()"),
        "the root must create, update, mount, and release one retained price-chart child"
    );
    assert!(
        chart.contains("export default class PriceChartView extends View"),
        "the retained child must own the price-chart view lifecycle"
    );
    for root_owned_hover_state in ["chartPointer", "chartHoverFramePending", "chartHover"] {
        assert!(
            !main.contains(root_owned_hover_state),
            "root still owns chart-local state {root_owned_hover_state}"
        );
    }
}

#[test]
fn responsive_panels_preserve_watchlist_and_detail_priorities() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");
    let watchlist = main
        .split("  watchlist(tokens) {")
        .nth(1)
        .and_then(|source| source.split("  /**\n   * A virtualized table").next())
        .expect("watchlist render method");
    let detail = main
        .split("  marketDetailPanel(tokens) {")
        .nth(1)
        .and_then(|source| source.split("  /**\n   * The chart").next())
        .expect("detail section render method");

    assert!(!detail.contains("this.isNarrow()"));
    assert!(
        watchlist.contains("const compact = this.isWatchlistCompact()")
            && watchlist.contains("watchlistHeader(tokens, compact)"),
        "Watchlist must keep full columns when wide and primary lanes when compact"
    );
    assert!(
        watchlist.contains("quoteRow(")
            && watchlist.contains("this.lastTick,")
            && watchlist.contains("compact,"),
        "virtual Watchlist rows must reuse the pane sizing decision without a host call"
    );
    assert_eq!(
        watchlist.matches("this.isNarrow()").count(),
        0,
        "virtual rows must make zero QuickJS-to-host viewport calls"
    );
    assert!(
        detail.contains("orderBookPanel(tokens, this.depthState, depthRatio(this.depthState))")
            && detail.contains("timeSalesPanel(tokens, this.tradesState, {")
            && !detail.contains("compact"),
        "detail lanes must be pane-safe by construction rather than switch from viewport compactness"
    );
    assert!(
        ui.contains("export const WATCHLIST_MIN_WIDTH = 400")
            && main.contains("watchlist.flex_basis(0).flex_grow(6).min_w(WATCHLIST_MIN_WIDTH)")
            && main.contains(".flex_grow(4)")
            && main.contains(".id(\"watchlist-panels-stacked\")")
            && main.find("workspacePanel(tokens, \"Watchlist\"")
                < main.find("workspacePanel(tokens, \"Quote Details\"")
            && main.find("workspacePanel(tokens, \"Quote Details\"")
                < main.find("const chart = workspacePanel(")
            && main.find("const chart = workspacePanel(")
                < main.find("workspacePanel(tokens, \"Market Detail\""),
        "plain Panels must use 6:4 when wide and stack in Watchlist, Quote, Chart, Market priority"
    );
}

#[test]
fn minimum_watchlist_keeps_symbol_name_last_and_change() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");

    assert!(
        main.contains("const COMPACT_WATCHLIST_WIDTH = 440")
            && ui.contains(".w(compact ? \"60%\" : \"31%\")")
            && ui.contains(".w(compact ? \"40%\" : \"19%\")")
            && ui.contains("quote.symbol")
            && ui.contains("quote.name")
            && ui.contains("quote.last")
            && ui.contains("quote.changePercent"),
        "compact Watchlist must keep Symbol + Name and Last + Chg"
    );
}

#[test]
fn responsive_breakpoints_use_the_same_gap_and_min_width_math_as_the_panels() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    assert!(
        main.contains("function responsivePanelWidths(viewportWidth)")
            && main.contains("const content = available - WORKSPACE_PANEL_GAP")
            && main.contains("content - WATCHLIST_MIN_WIDTH")
            && main.contains("responsivePanelWidths(window.viewport_size().width).watchlist")
            && main.contains("responsivePanelWidths(window.viewport_size().width).detail")
            && main.matches(".gap(WORKSPACE_PANEL_GAP)").count() == 3,
        "Watchlist columns and Chart controls must use the exact widths produced by the 6:4 Panel layout"
    );
}

#[test]
fn minimum_chart_keeps_a_real_plot_below_compact_interval_tabs() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        main.contains("Tabs.new(\"chart-mode-tabs\")")
            && main.contains("Tab.new(`chart-mode-${id}`)")
            && main.contains(".justify_center()")
            && main.contains(".text_size(11)")
            && main.contains(".border_b(2)")
            && main.contains(".id(\"price-chart-wheel\")")
            && main.contains(".min_h(244)")
            && main.contains(".child(this.priceChart)"),
        "the minimum Chart Panel must retain compact underline tabs and a visible plot"
    );
    assert!(
        main.contains("if (chartWidth < 440)")
            && main.contains("Popover.new(\"chart-mode-menu\")")
            && main.contains("Button.new(\"chart-mode-menu-trigger\")"),
        "a narrow Chart TitleBar must replace the tabs with a compact interval dropdown"
    );
}

#[test]
fn title_bar_has_no_obsolete_detail_dock_toggle() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        !main.contains("detailToggle") && !main.contains("workspaceDock"),
        "plain responsive Panels must not leave a Dock toggle in the TitleBar"
    );
}

#[test]
fn panel_layout_has_no_resize_or_persistence_hot_path() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");

    assert!(
        !main.contains("WORKSPACE_LAYOUT_KEY")
            && !main.contains("localStorage.setItem(WORKSPACE_LAYOUT_KEY")
            && !ui.contains("resize_dock("),
        "responsive Panels must not persist or resize a Dock"
    );
}

#[test]
fn workspace_outer_gap_is_not_double_padded() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let render = main
        .split("  render(cx) {")
        .nth(1)
        .expect("application render method");

    assert!(
        render.contains(".px(PANE_INSET)")
            && render.contains(".pb(PANE_INSET)")
            && render.contains(".pt(0)"),
        "the shell keeps 8px side/bottom gaps while the first panel sits 4px below the TitleBar"
    );
}

#[test]
fn retained_chart_props_do_not_duplicate_the_large_series() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let chart_props = main
        .split("  chartProps() {")
        .nth(1)
        .and_then(|source| source.split("  nextPriceChartProps() {").next())
        .expect("chartProps method");

    assert!(
        !chart_props.contains("series:")
            && !main.contains("previous?.series === next.series")
            && chart_props.contains("compactIntradaySeriesForView"),
        "the retained chart must receive one mode-specific series, not a duplicate five-day graph"
    );
}

#[test]
fn window_declares_a_minimum_workbench_size() {
    let host = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("main.rs"),
    )
    .expect("src/main.rs");
    assert!(
        host.contains("window_min_size: Some(size(px(720.), px(600.)))"),
        "the native window must preserve the Watchlist and Right Dock minimum widths"
    );
}

#[test]
fn time_sales_volume_markers_use_directional_semantic_tones_and_intensity() {
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");

    assert!(
        ui.contains("bg(direction.tone)") && ui.contains("opacity(volumeIntensity(ratio))"),
        "trade volume fills must use semantic direction tone and bounded depth intensity"
    );
    assert!(
        ui.contains("statusColors(tokens).up")
            && ui.contains("statusColors(tokens).down")
            && ui.contains("tokens.muted_foreground"),
        "up, down, and neutral trade directions require separate semantic tones"
    );
}

#[test]
fn depth_and_trade_pushes_invalidate_only_the_market_detail_panel() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    for method in [
        "receiveDetailError(detail, cx)",
        "receiveDepth(depth, cx, generation)",
        "receiveTrades(payload, cx, generation)",
    ] {
        let body = main
            .split(method)
            .nth(1)
            .and_then(|source| source.split("\n  /**").next())
            .expect("detail market mutation method");
        assert!(
            body.contains("this.scheduleRedraw(cx, PANE_MARKET);"),
            "{method} must coalesce publication to Market Detail"
        );
        assert!(
            !body.contains("PANE_DETAIL"),
            "{method} must not notify Quote or the retained Chart"
        );
    }
}

#[test]
fn responsive_workspace_uses_plain_panel_chrome() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");
    assert!(
        ui.contains(
            "export function workspacePanel(tokens, title, content, accessory = null, options = {})",
        )
            && main.matches("workspacePanel(").count() >= 4
            && !main.contains("dockFrame")
            && !main.contains("dockTabBar"),
        "all four readings must use the same plain Panel title/content frame"
    );
}

#[test]
fn plain_panels_have_no_tile_hit_geometry() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        !main.contains("bounds: { x: tile.x")
            && !main.contains(".move_tile(")
            && !main.contains(".resize_tile("),
        "production must not use tile geometry or tile interactions"
    );
}

#[test]
fn responsive_layout_has_no_saved_dock_or_tile_tree() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        !main.contains("workspaceDock")
            && !main.contains("tabState(")
            && !main.contains("detailStackState")
            && !main.contains("info: { tiles:"),
        "plain responsive Panels must have no retained Dock or Tile layout tree"
    );
}

#[test]
fn details_column_prioritizes_quote_chart_then_market() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        main.contains(".id(\"detail-panels\")")
            // Quote Details is sized for what it now holds -- a heading, a
            // grid of readings and a disclosure -- rather than for the three
            // metric columns it used to be.
            && main.matches(".child(quote.flex_none())").count() == 2
            && main.contains(".child(chart.flex_basis(290)")
            && main.contains(".child(market.flex_basis(240)"),
        "the 6:4 layout must keep Quote, Chart and Market as ordered independent Panels"
    );
    assert!(
        main.contains("marketDetailPanel(tokens)")
            && main.contains("overflow_y_scrollbar()")
            && main.contains(".child(this.priceChart)"),
        "Market Detail owns its tape/book scroll while Chart remains retained"
    );
}

#[test]
fn plain_panel_title_has_one_title_and_one_content_region() {
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");

    assert!(
        ui.contains(
            "export function workspacePanel(tokens, title, content, accessory = null, options = {})",
        ) && ui.contains(".child(label(tokens, title, 13).font_weight(700))")
            && ui.contains(".when(accessory, (element) => element.child(accessory))")
            && ui.contains(
                ".child(grow ? content.border(0).flex_1().min_h(0) : content.border(0).flex_none())",
            )
            && !ui.contains("drag_tab("),
        "plain Panel must contain one title region and one content region"
    );
}

#[test]
fn responsive_panels_own_one_consistent_omarchy_gap_and_the_title_bar_has_no_rule() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");
    let title_bar = main
        .split("  titleBar(tokens) {")
        .nth(1)
        .and_then(|source| source.split("  /**\n   * The session menu").next())
        .expect("title bar method");

    assert!(
        !title_bar.contains(".border_b(1)"),
        "the application TitleBar must not add a rule above the first Panel gap"
    );
    assert!(
        ui.contains("export const PANE_INSET = 4")
            && main.contains(".gap(tokens.spacing.sm)")
            && main.contains(".px(PANE_INSET)")
            && main.contains(".pt(0)"),
        "all four plain Panels must use the same 8px peer gap and compact shell inset"
    );
}

#[test]
fn title_mark_preserves_official_multicolor_roles_with_live_semantic_tokens() {
    let root = app_dir();
    let main = fs::read_to_string(root.join("main.js")).expect("main.js");
    let official =
        fs::read_to_string(root.join("assets/logo-light.svg")).expect("official light logo");
    let layers: [(&str, &str, &[&str]); 4] = [
        (
            "logo-foreground.svg",
            "tokens.foreground",
            &[
                "x=\"0\" y=\"0\" width=\"3\" height=\"69\"",
                "x=\"33\" y=\"60\" width=\"3\" height=\"9\"",
                "x=\"53\" y=\"43\" width=\"9\" height=\"26\"",
            ],
        ),
        (
            "logo-info-cyan.svg",
            "status.info",
            &["x=\"7\" y=\"0\" width=\"10\" height=\"69\""],
        ),
        (
            "logo-warning.svg",
            "status.warning",
            &["x=\"21\" y=\"60\" width=\"9\" height=\"9\""],
        ),
        (
            "logo-danger.svg",
            "status.down",
            &[
                "x=\"40\" y=\"52\" width=\"10\" height=\"17\"",
                "x=\"66\" y=\"26\" width=\"3\" height=\"43\"",
            ],
        ),
    ];

    assert!(
        layers.iter().all(|(asset, token, _)| {
            main.contains(&format!("svg(\"assets/{asset}\")"))
                && main.contains(&format!(".text_color({token})"))
        }) && main.contains("const status = statusColors(tokens);")
            && !main.contains("assets/logo-info.svg")
            && main.contains("this.titleBar(tokens)")
            && !main.contains(".child(div().absolute().left(1)")
            && !main.contains("assets/logo-dark.svg")
            && !main.contains("assets/logo-light.svg"),
        "the title mark must resolve semantic layer colours from the current render theme, rather than a hand-built or fixed-palette glyph"
    );

    assert!(
        official.contains("width=\"69px\" height=\"69px\" viewBox=\"0 0 69 69\"")
            && layers.iter().all(|(asset, _, rects)| {
                let layer = fs::read_to_string(root.join("assets").join(asset))
                    .unwrap_or_else(|_| panic!("themed title logo layer {asset}"));
                layer.contains("width=\"69px\" height=\"69px\" viewBox=\"0 0 69 69\"")
                    && layer.matches("<rect").count() == rects.len()
                    && layer.matches("fill=\"currentColor\"").count() == rects.len()
                    && rects.iter().all(|rect| layer.contains(rect))
                    && !layer.contains("#00")
                    && !layer.contains("#FC")
                    && !layer.contains("#FF")
            }),
        "every logo layer must preserve the official 69x69 frame and inherit its semantic colour"
    );

    let all_layer_rects = layers
        .iter()
        .flat_map(|(asset, _, _)| {
            let layer =
                fs::read_to_string(root.join("assets").join(asset)).expect("title logo layer");
            [
                "x=\"0\" y=\"0\" width=\"3\" height=\"69\"",
                "x=\"21\" y=\"60\" width=\"9\" height=\"9\"",
                "x=\"33\" y=\"60\" width=\"3\" height=\"9\"",
                "x=\"53\" y=\"43\" width=\"9\" height=\"26\"",
                "x=\"66\" y=\"26\" width=\"3\" height=\"43\"",
                "x=\"40\" y=\"52\" width=\"10\" height=\"17\"",
                "x=\"7\" y=\"0\" width=\"10\" height=\"69\"",
            ]
            .into_iter()
            .filter(move |rect| layer.contains(rect))
            .map(str::to_owned)
        })
        .collect::<Vec<_>>();
    assert_eq!(
        all_layer_rects.len(),
        7,
        "the seven official rectangles must be distributed across the themed layers exactly once"
    );
    for rect in [
        "x=\"0\" y=\"0\" width=\"3\" height=\"69\"",
        "x=\"21\" y=\"60\" width=\"9\" height=\"9\"",
        "x=\"33\" y=\"60\" width=\"3\" height=\"9\"",
        "x=\"53\" y=\"43\" width=\"9\" height=\"26\"",
        "x=\"66\" y=\"26\" width=\"3\" height=\"43\"",
        "x=\"40\" y=\"52\" width=\"10\" height=\"17\"",
        "x=\"7\" y=\"0\" width=\"10\" height=\"69\"",
    ] {
        assert_eq!(
            all_layer_rects
                .iter()
                .filter(|candidate| candidate.as_str() == rect)
                .count(),
            1,
            "official rectangle {rect} must appear in exactly one semantic layer"
        );
    }
}

#[test]
fn workspace_repaints_do_not_checkpoint_the_market_model() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    assert!(
        main.contains("this.repaint = cx.timer.after(100")
            && !main.contains("cx.notify(this.watchlistPanel)")
            && !main.contains("cx.notify(this.marketDetailDockPanel)"),
        "inline responsive panels must coalesce feed repaints without nested panel checkpoints"
    );
    assert!(
        !main.contains("workspaceRevision") && !main.contains("const props = { revision:"),
        "pane repaint must not manufacture props only to cross the nested-view update path"
    );
}

#[test]
fn responsive_panels_do_not_create_nested_application_views() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    assert!(
        !app_dir().join("workspace.js").exists()
            && !main.contains("holdWorkspaceApp")
            && !main.contains("paneRevisions"),
        "plain Panels must stay in the root tree without nested views retaining the market graph"
    );
}

#[test]
fn chart_publication_yields_to_interaction_and_is_rate_limited() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        main.contains("const CHART_PUBLISH_INTERVAL_MS = 500")
            && main.contains("Date.now() - this.chartPublishedAt >= CHART_PUBLISH_INTERVAL_MS"),
        "live quotes must not publish the complete five-day chart on every feed repaint"
    );
    assert!(
        main.contains("this.chartPublish = cx.timer.after(0")
            && main.contains("this.publishChart(cx)"),
        "selection and load handlers must defer the large chart update so their first frame can paint"
    );

    let select_quote = main
        .split("selectQuote(symbol, cx) {")
        .nth(1)
        .and_then(|source| source.split("\n  }").next())
        .expect("selectQuote source");
    let redraw = select_quote
        .find("this.redraw(cx)")
        .expect("selection redraw");
    let load = select_quote
        .find("this.loadSelectedChart(cx)")
        .expect("chart load");
    assert!(
        redraw < load,
        "the selected Watchlist row must be submitted for paint before chart loading/publishing starts"
    );
}

#[test]
fn release_build_resolves_packaged_application_resources() {
    let manifest = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
        .expect("Cargo.toml");
    let host = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/main.rs"))
        .expect("src/main.rs");

    assert!(
        manifest.contains("name = \"longbridge-lite\""),
        "the Cargo package and executable must use the release product name"
    );
    assert!(
        host.contains("LONGBRIDGE_LITE_APP_DIR")
            && host.contains("Resources").then_some(()).is_some()
            && host.contains("share").then_some(()).is_some(),
        "the host must resolve explicit, macOS, and portable application resource locations"
    );
    let resolver = host
        .split("fn application_dir()")
        .nth(1)
        .and_then(|source| source.split("\nfn ").next())
        .expect("application_dir resolver");
    let override_position = resolver
        .find("LONGBRIDGE_LITE_APP_DIR")
        .expect("environment override");
    let development_position = resolver
        .find("CARGO_MANIFEST_DIR")
        .expect("development fallback");
    assert!(
        override_position < development_position,
        "the source checkout may only be the final development fallback"
    );
}
