use std::{path::PathBuf, rc::Rc};

use gpui::{AppContext as _, Bounds, TitlebarOptions, WindowBounds, WindowOptions, px, size};
use gpui_shell::{AppAssets, ShellRoot, ShellRuntime, plugin::PluginManager, theme::Palettes};

const PLUGIN_ID: &str = "com.longbridge.gpui-shell-example";

fn main() {
    let app_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app");
    let assets = AppAssets::new(app_root.clone());

    gpui_platform::application()
        .with_assets(assets)
        .run(move |cx| {
            gpui_shell::init(cx);
            Palettes::parse(include_str!("../app/palette.json"))
                .expect("invalid Longbridge palette")
                .install(cx);

            let runtime = ShellRuntime::new(cx).expect("failed to start gpui-shell runtime");
            let mut plugins = PluginManager::new(vec![app_root.clone()]);
            plugins.discover();

            let runtime = Rc::clone(&runtime);
            let source_root = app_root.clone();
            cx.open_window(window_options(cx), move |window, cx| {
                plugins
                    .load(&runtime, PLUGIN_ID, |_| true, window, cx)
                    .expect("failed to load Longbridge application");
                let view = plugins
                    .plugin(PLUGIN_ID)
                    .expect("Longbridge plugin was not retained")
                    .view()
                    .clone();
                #[cfg(debug_assertions)]
                gpui_shell::watch::Watch::start(
                    &runtime,
                    &view,
                    source_root.clone(),
                    "main.js",
                    window,
                    cx,
                )
                .forget();
                let content = view.into();
                cx.new(|cx| ShellRoot::new(content, window, cx))
            })
            .expect("failed to open Longbridge window");
        });
}

fn window_options(cx: &gpui::App) -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(px(1120.), px(760.)),
            cx,
        ))),
        titlebar: Some(TitlebarOptions {
            title: Some("Longbridge Read-only Terminal".into()),
            ..Default::default()
        }),
        ..Default::default()
    }
}
