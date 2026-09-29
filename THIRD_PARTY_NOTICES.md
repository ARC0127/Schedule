# Third-party notices

Schedule source is MIT licensed. Dependencies retain their own terms.

| Component                           | Version      | License / source                                                                           |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| Lucide                              | 1.17.0       | ISC; some Feather-derived icons under MIT. See `third_party/Lucide-LICENSE.txt`.           |
| Microsoft.Web.WebView2              | 1.0.3650.58  | Microsoft software license; see `third_party/WebView2-LICENSE.txt`.                        |
| Microsoft.Toolkit.Uwp.Notifications | 7.1.3        | MIT, .NET Foundation and Contributors; see `third_party/Toolkit-LICENSE.txt`.              |
| System.ValueTuple                   | 4.5.0        | MIT; see `third_party/ValueTuple-LICENSE.txt`.                                             |
| Microsoft.Windows.SDK.Contracts     | 10.0.19041.1 | Microsoft Windows SDK terms; compile-time reference package, not bundled into the runtime. |

NuGet dependencies are downloaded from `api.nuget.org` during the build. WebView2 Runtime and .NET Framework are system prerequisites, not redistributed by this repository. Playwright is an Apache-2.0 development-only test dependency.
