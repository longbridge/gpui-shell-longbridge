use std::{path::PathBuf, rc::Rc, time::Duration};

use gpui::{
    AnyElement, AppContext as _, Bounds, Context, IntoElement, Render, SharedString,
    TitlebarOptions, Window, WindowBounds, WindowOptions, px, size,
};
use gpui_shell::{AppAssets, ShellRoot, ShellRuntime, plugin::PluginManager};

const PLUGIN_ID: &str = "com.longbridge.gpui-shell-example";

fn main() {
    let app_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app");
    let assets = AppAssets::new(app_root.clone());

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    gpui_platform::application()
        .with_assets(assets)
        .run(move |cx| {
            gpui_shell::init(cx);

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
            // The manager owns the loaded plugin, and dropping it shuts that
            // plugin down: every retained entity released, every task of its
            // cancelled. It used to be moved into the window closure, so the
            // application was unloaded the moment the window was built -- which
            // stayed invisible for exactly as long as nothing in the script
            // held retained state or ran a task past startup. The filters hold
            // `InputState` and the palette arrives on a task, so both broke at
            // once. It lives as long as the process now, because so does the
            // one application it loaded.
            let plugins: &'static mut PluginManager = Box::leak(Box::new(plugins));

            let runtime = Rc::clone(&runtime);
            cx.open_window(window_options(cx), move |window, cx| {
                // Not `expect`. This closure runs inside GPUI's window-open
                // callback, which cannot unwind, so a panic here does not fail
                // the load -- it aborts the process, and the message scrolls
                // past in a terminal the user may not even be looking at. A
                // script that will not load is an ordinary outcome (a typo, a
                // missing capability, a runtime older than the application),
                // and gpui-shell publishes `failure_surface` for exactly it:
                // the window opens and says what happened.
                let content = match load_application(&mut *plugins, &runtime, window, cx) {
                    Ok(view) => view,
                    Err(error) => {
                        eprintln!("the Longbridge application did not load: {error}");
                        cx.new(|_| LoadFailure {
                            message: error.into(),
                        })
                        .into()
                    }
                };
                // TODO: hot reload is off while the host cannot have both it
                // and the manifest's capabilities. `ShellRuntime::watch` reads
                // the application back off the `ShellRoot`, and only
                // `ShellRoot::with_application` fills that in -- which is
                // `pub(crate)`, reachable from a host only through
                // `ShellRuntime::load`. That path documents itself as always
                // using the policy the host installed rather than the
                // manifest's, and this application needs the manifest's: its
                // fs and network grants are declared there.
                cx.new(|cx| ShellRoot::new(content, window, cx))
            })
            .expect("failed to open Longbridge window");
        });
}

/// Loads the application and hands back the view to mount, or the reason not to.
fn load_application(
    plugins: &mut PluginManager,
    runtime: &Rc<ShellRuntime>,
    window: &mut Window,
    cx: &mut gpui::App,
) -> Result<gpui::AnyView, String> {
    plugins
        .load(runtime, PLUGIN_ID, |_| true, window, cx)
        .map_err(|error| format!("{error:#}"))?;
    let plugin = plugins
        .plugin(PLUGIN_ID)
        .ok_or_else(|| format!("the manager did not retain `{PLUGIN_ID}` after loading"))?;
    Ok(plugin.view().clone().into())
}

/// What the window shows when the application did not load.
///
/// The surface itself is gpui-shell's, so this reads the same as every other
/// load failure that runtime reports and takes its colors from the same
/// semantic roles.
struct LoadFailure {
    message: SharedString,
}

impl Render for LoadFailure {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        AnyElement::from(gpui_shell::failure_surface(
            "This application could not be loaded",
            &self.message,
            "Fix the reason above and start it again.",
            window,
            cx,
        ))
    }
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
