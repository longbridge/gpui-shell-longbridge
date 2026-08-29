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
fn application_exposes_api_backed_read_only_views() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");
    let market = fs::read_to_string(app_dir().join("market.js")).expect("market.js");

    assert!(
        main.contains("/v1/watchlist/groups"),
        "watchlist must load from the read-only API"
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
    // The forbidden list is about edit controls. Read-only market-detail
    // panels may now use bid, ask, and time-and-sales terminology; `InputState`
    // remains limited to the two list filters, which narrow what is already on
    // screen and never mutate the watchlist.
    for forbidden in ["Add symbol", "Remove", "Place order", "Cancel order"] {
        assert!(
            !main.contains(forbidden) && !ui.contains(forbidden) && !market.contains(forbidden),
            "forbidden editing or trading surface {forbidden}"
        );
    }
    for forbidden in ["Buy", "Sell"] {
        assert!(
            !main.contains(&format!("\"{forbidden}\""))
                && !ui.contains(&format!("\"{forbidden}\""))
                && !market.contains(&format!("\"{forbidden}\"")),
            "forbidden trading control label {forbidden}"
        );
    }
    for forbidden in [
        "trade::buy",
        "trade::sell",
        "trade::place-order",
        "trade::cancel-order",
    ] {
        assert!(
            !main.contains(forbidden) && !ui.contains(forbidden) && !market.contains(forbidden),
            "forbidden trading action {forbidden}"
        );
    }
    assert!(
        main.matches("InputState.new({ placeholder:").count() == 2
            && main.contains("Filter watchlist")
            && main.contains("Filter holdings"),
        "the only retained text state may be the two list filters"
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
        main.contains("dock_area(this.workspaceDock)")
            && main.contains("DockArea.register_panel(\"watchlist\", WatchlistPanel)")
            && main.contains("DockArea.register_panel(\"quote-details\", QuoteDetailsPanel)")
            && main.contains("DockArea.register_panel(\"chart\", ChartPanel)")
            && main.contains("DockArea.register_panel(\"market-detail\", MarketDetailPanel)")
            && !main.contains(".tile_drag_bar("),
        "Watchlist and three detail readings must be independent Dock panels without Tiles"
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
fn watchlist_and_detail_panes_do_not_depend_on_window_viewport_width() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
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
fn tiled_detail_dock_exposes_drag_and_resize_chrome() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    assert!(
        main.contains("dockTabBar(cx.theme(), group)")
            && main.contains("dockDropHint(cx.theme(), drop)")
            && main.contains("dockFrame(cx.theme(), dock")
            && !main.contains("dockTileDragBar"),
        "Dock panels need tab/split chrome but no Tile chrome"
    );
}

#[test]
fn tiled_detail_dock_hit_geometry_matches_the_current_dock_api() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        !main.contains("bounds: { x: tile.x")
            && !main.contains(".move_tile(")
            && !main.contains(".resize_tile("),
        "production must not use tile geometry or tile interactions"
    );
}

#[test]
fn v3_detail_tile_layout_round_trips_through_app_owned_storage() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");

    assert!(
        main.contains("workspaceDock.load(layout)")
            && main.contains("info: { stack: { sizes: [220, 300, 0], axis: 1 } }")
            && !main.contains("info: { tiles:"),
        "saved Dock split/tab layouts must restore without a Tile tree"
    );
}

#[test]
fn detail_dock_defaults_to_three_rearrangeable_vertical_tiles() {
    let main = fs::read_to_string(app_dir().join("main.js")).expect("main.js");
    let workspace = fs::read_to_string(app_dir().join("workspace.js")).expect("workspace.js");

    assert!(
        main.contains("tabState(\"quote-details\")")
            && main.contains("tabState(\"chart\")")
            && main.contains("tabState(\"market-detail\")")
            && workspace.contains("export class QuoteDetailsPanel")
            && workspace.contains("export class ChartPanel")
            && workspace.contains("export class MarketDetailPanel"),
        "Quote, Chart and Market Detail must default to three vertical independent Dock panels"
    );
    assert!(
        main.contains("marketDetailPanel(tokens)")
            && main.contains("overflow_y_scrollbar()")
            && workspace.contains("this.app.chartDetailsPanel(cx.theme())"),
        "only Market Detail owns the tape/book scroll and it cannot remount the retained chart"
    );
}

#[test]
fn dock_tab_bar_hides_one_tab_but_keeps_multi_tab_navigation() {
    let ui = fs::read_to_string(app_dir().join("ui.js")).expect("ui.js");

    assert!(
        ui.contains("if (tabs.length === 1)")
            && ui.contains("tabs.map(")
            && ui.contains(".select_tab(group, tab.index)"),
        "one panel must show a title region while combined panels show draggable tabs"
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
