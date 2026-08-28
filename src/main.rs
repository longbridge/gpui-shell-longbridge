use std::{path::PathBuf, rc::Rc, time::Duration};

use gpui::{
    AnyElement, App, AppContext as _, Bounds, Context, IntoElement, KeyBinding, Menu, MenuItem,
    Render, SharedString, TitlebarOptions, Window, WindowBounds, WindowOptions, actions, point, px,
    size, transparent_black,
};
use gpui_shell::{AppAssets, ShellRoot, ShellRuntime, plugin::PluginManager};

const PLUGIN_ID: &str = "com.longbridge.gpui-shell-example";

/// How tall the application draws its own title bar, and where the macOS
/// traffic lights have to sit inside it.
///
/// The number lives here rather than only in the script because the window
/// options are the host's: AppKit places the lights before a single frame is
/// rendered, so the two have to agree by construction. `app/main.js` carries
/// the same constant, and a change to one is a change to both.
const TITLE_BAR_HEIGHT: f32 = 44.;

/// The lights are 14pt tall, so this centers them in the bar above.
const TRAFFIC_LIGHT_INSET: f32 = (TITLE_BAR_HEIGHT - 14.) / 2.;

actions!(
    longbridge,
    [
        /// Leaves the application.
        Quit
    ]
);

/// The interface's one font family, bundled rather than looked up.
///
/// The whole application is monospaced, and a family the machine may not have
/// is not a family the script can ask for: GPUI resolves `font_family` to a
/// *single* installed family name, and when it misses it falls through to its
/// own fallback stack, which is the platform's **proportional** UI face. There
/// is no CSS-style chain and no way for a script to ask what is installed, so
/// "JetBrains Mono" is only safe to name once the process has put it there.
///
/// `include_bytes!` rather than a read from the asset directory, so a missing
/// file is a build error instead of an interface that silently comes up in
/// Helvetica. `app/main.js` names this family, and the two have to agree.
const FONTS: [&[u8]; 2] = [
    include_bytes!("../app/assets/fonts/JetBrainsMono-Regular.ttf"),
    include_bytes!("../app/assets/fonts/JetBrainsMono-Bold.ttf"),
];

fn main() {
    let app_root = application_dir().unwrap_or_else(|error| {
        eprintln!("Longbridge Lite cannot find its application resources: {error}");
        std::process::exit(1);
    });
    if std::env::args_os().any(|argument| argument == "--check-resources") {
        println!("{}", app_root.display());
        return;
    }
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
            // Before the first frame: the family has to be resolvable by the
            // time anything asks for it. `add_fonts` registers into the text
            // system's own memory source, which is the source consulted ahead
            // of the installed ones, so this wins over a differently-versioned
            // JetBrains Mono the machine happens to have.
            cx.text_system()
                .add_fonts(FONTS.iter().map(|font| std::borrow::Cow::Borrowed(*font)).collect())
                .expect("the bundled JetBrains Mono did not load");
            install_quit(cx);
            // The seam between Watchlist and Stock details reads as a gap, not
            // as a line. The two panes are a dock's center and its right dock,
            // and base draws the divider between them from the `resizable`
            // theme -- the `border` color, the same one every panel edge uses --
            // which turned the eight pixels the panes give each other into a
            // rule down the middle of one panel. The script cannot reach it:
            // `set_theme` carries the semantic tokens and nothing else. So the
            // host projects it. `active_handle` stays unset, so a drag still
            // lights up in `ring` -- the one moment the divider is worth
            // seeing.
            gpui_base::Theme::global_mut(cx).resizable.handle = Some(transparent_black());
            // The script's "Exit" asks; what the ask *means* is the host's to
            // decide, and here it means the same as Cmd-Q.
            gpui_shell::on_exit_request(|_request, _window, cx| cx.quit());
            // With the last window gone there is no interface left, and on
            // Linux and Windows no menu bar to quit from either.
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);

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
                            "shell-profile script={} mean_script={:.3}ms slowest_script={:.3}ms materialize={} mean_materialize={:.3}ms script_total={:.3}ms materialize_total={:.3}ms",
                            interval.script_renders(),
                            interval.mean_script_render().as_secs_f64() * 1_000.0,
                            interval.slowest_script_render().as_secs_f64() * 1_000.0,
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

/// Finds the script application in an installed bundle or the source tree.
///
/// Release packages are relocatable: every candidate is derived from the
/// executable itself. The manifest-directory path is deliberately last and
/// exists only for `cargo run` from a checkout.
fn application_dir() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("LONGBRIDGE_LITE_APP_DIR") {
        let path = PathBuf::from(path);
        return is_application_dir(&path)
            .then_some(path)
            .ok_or_else(|| "LONGBRIDGE_LITE_APP_DIR does not contain gpui-shell.json".to_owned());
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("could not locate the executable: {error}"))?;
    let binary_dir = executable
        .parent()
        .ok_or_else(|| "the executable has no parent directory".to_owned())?;
    let bundle_root = binary_dir.parent().unwrap_or(binary_dir);
    let candidates = [
        bundle_root.join("Resources").join("app"),
        bundle_root.join("share").join("app"),
        bundle_root.join("app"),
        binary_dir.join("app"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app"),
    ];
    candidates
        .into_iter()
        .find(|path| is_application_dir(path))
        .ok_or_else(|| {
            format!(
                "no app/gpui-shell.json was found beside {} or in the development checkout",
                executable.display()
            )
        })
}

fn is_application_dir(path: &std::path::Path) -> bool {
    path.join("gpui-shell.json").is_file()
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
        // No system title bar: the application draws its own, and the script
        // owns what is in it. `appears_transparent` keeps the AppKit title bar
        // in place but empty and see-through, so the window still drags from
        // the top strip and still gets its traffic lights -- which the script
        // cannot ask for, since it can neither move the window nor close it.
        // `app_owns_titlebar_drag` therefore stays false.
        titlebar: Some(TitlebarOptions {
            title: None,
            appears_transparent: true,
            traffic_light_position: Some(point(px(TRAFFIC_LIGHT_INSET), px(TRAFFIC_LIGHT_INSET))),
        }),
        ..Default::default()
    }
}

/// Wires Quit to the gesture each platform expects, and to the macOS app menu.
///
/// The binding comes first on both platforms, and on macOS the menu item is
/// built on top of it rather than instead of it: AppKit takes the accelerator
/// it shows next to a menu item from the bindings registered for that item's
/// action, so a menu with no binding behind it is a menu item with no Cmd-Q.
///
/// Both are dispatched globally, with no context, because leaving is not a
/// view's to own -- whichever pane holds the keyboard, the gesture means the
/// same thing.
fn install_quit(cx: &mut App) {
    cx.on_action(|_: &Quit, cx| cx.quit());
    if cfg!(target_os = "macos") {
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
        cx.set_menus(vec![Menu {
            name: "Longbridge".into(),
            items: vec![MenuItem::action("Quit Longbridge", Quit)],
            disabled: false,
        }]);
    } else {
        cx.bind_keys([KeyBinding::new("alt-f4", Quit, None)]);
    }
}
