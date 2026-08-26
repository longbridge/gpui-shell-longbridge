use std::{path::PathBuf, rc::Rc, time::Duration};

use gpui::{AppContext as _, Bounds, TitlebarOptions, WindowBounds, WindowOptions, px, size};
use gpui_shell::{
    AppAssets, ShellRoot, ShellRuntime,
    plugin::PluginManager,
    theme::{Palettes, ThemeMode, set_mode},
};

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
            set_mode(ThemeMode::Dark, cx);

            let runtime = ShellRuntime::new(cx).expect("failed to start gpui-shell runtime");
            if std::env::var_os("LONGBRIDGE_PROFILE").is_some() {
                let measured = Rc::clone(&runtime);
                cx.spawn(async move |cx| {
                    let mut previous = measured.read_metrics();
                    loop {
                        cx.background_executor().timer(Duration::from_secs(1)).await;
                        let current = measured.read_metrics();
                        let interval = current.since(&previous);
                        previous = current;
                        eprintln!(
                            "shell-profile script={} mean_script={:.3}ms materialize={} mean_materialize={:.3}ms script_total={:.3}ms materialize_total={:.3}ms",
                            interval.script_renders(),
                            interval.mean_script_render().as_secs_f64() * 1_000.0,
                            interval.materializations(),
                            interval.mean_materialize().as_secs_f64() * 1_000.0,
                            interval.script_render_time().as_secs_f64() * 1_000.0,
                            interval.materialize_time().as_secs_f64() * 1_000.0,
                        );
                    }
                })
                .detach();
            }
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
                .expect("failed to watch Longbridge application sources")
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
