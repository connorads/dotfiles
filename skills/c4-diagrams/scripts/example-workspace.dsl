workspace "Internet Banking System" "A worked C4 example: Context, Container, Component, Deployment." {

    model {
        customer = person "Personal Banking Customer" "A customer of the bank with personal accounts."

        banking = softwareSystem "Internet Banking System" "Lets customers view accounts and make payments." {
            web    = container "Web Application"   "Serves the SPA and static content."        "Java, Spring MVC"
            spa    = container "Single-Page App"   "Provides banking features in the browser."  "JavaScript, React"
            mobile = container "Mobile App"        "Provides banking features on mobile."       "Kotlin, Swift"
            api    = container "API Application"    "Provides banking features over JSON/HTTPS." "Java, Spring Boot" {
                signin   = component "Sign In Controller"  "Handles authentication requests."     "Spring MVC Controller"
                accounts = component "Accounts Controller" "Serves account and balance data."     "Spring MVC Controller"
                mainframeGateway = component "Mainframe Gateway" "Talks to the mainframe."         "Spring Bean"
            }
            db = container "Database" "Stores users, accounts and audit records." "PostgreSQL" {
                tags "Database"
            }
        }

        mainframe = softwareSystem "Mainframe Banking System" "Stores core banking information." {
            tags "External"
        }
        email = softwareSystem "E-mail System" "Microsoft Exchange." {
            tags "External"
        }

        # relationships
        customer -> web    "Visits bigbank.com using" "HTTPS"
        customer -> spa    "Views accounts and makes payments using" "HTTPS"
        customer -> mobile "Views accounts and makes payments using"
        web -> spa "Delivers to the customer's browser"
        spa    -> api "Makes API calls to" "JSON/HTTPS"
        mobile -> api "Makes API calls to" "JSON/HTTPS"
        signin   -> db "Reads from and writes to" "JDBC"
        accounts -> db "Reads from" "JDBC"
        mainframeGateway -> mainframe "Makes API calls to" "XML/HTTPS"
        api -> email "Sends e-mail using" "SMTP"
        email -> customer "Sends e-mails to" "SMTP"

        # deployment (one environment)
        production = deploymentEnvironment "Production" {
            deploymentNode "Customer's device" "" "iOS or Android" {
                containerInstance mobile
            }
            deploymentNode "Bank data centre" "" "" {
                deploymentNode "bigbank-web***" "" "Ubuntu 22.04, Docker" {
                    containerInstance web
                }
                deploymentNode "bigbank-api***" "" "Ubuntu 22.04, Docker" {
                    containerInstance api
                }
                deploymentNode "bigbank-db01" "" "Ubuntu 22.04" {
                    containerInstance db
                }
            }
        }
    }

    views {
        systemContext banking "Context" {
            include *
            autoLayout lr
        }
        container banking "Containers" {
            include *
            autoLayout lr
        }
        component api "API-Components" {
            include *
            autoLayout lr
        }
        deployment banking production "Production-Deployment" {
            include *
            autoLayout lr
        }

        styles {
            element "Element"  { color #ffffff }
            element "Person"   { shape person background #08427b }
            element "Software System" { background #1168bd }
            element "External" { background #999999 }
            element "Container" { background #438dd5 }
            element "Component" { background #85bbf0 color #000000 }
            element "Database" { shape cylinder }
        }
    }
}
